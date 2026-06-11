import { parseEbookTitles, parseJournals, parsePrintedBooks } from "@/lib/parsers";
import { pageThrough } from "@/lib/paging";
import { ndjsonStream } from "@/lib/streaming";
import { RESOURCE_BY_ID, isResourceTypeId, type ResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";
import type { TitleRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 500;

export async function POST(req: Request, { params }: { params: { type: string } }) {
  const form = await req.formData();
  const file = form.get("file");
  const campusInput = ((form.get("campus") as string | null) ?? "").trim();

  const stream = ndjsonStream(async (send) => {
    if (!isResourceTypeId(params.type)) {
      throw new Error(`Unknown resource type: ${params.type}`);
    }
    const rt = RESOURCE_BY_ID[params.type];
    if (!(file instanceof File)) throw new Error("Missing file");
    // Printed types must carry a campus so reports can scope to it.
    if (rt.campusScoped && !campusInput) {
      throw new Error(`This resource type (${rt.uiLabel}) is campus-specific. Please pick a campus before uploading.`);
    }
    const campus = rt.campusScoped ? campusInput : "";
    send({ phase: "parsing" });
    const buf = Buffer.from(await file.arrayBuffer());

    // Pick parser by resource kind. Books use the existing parsers; journals
    // use the dedicated journal parser that maps issn/call_no aliases.
    let records: TitleRow[];
    if (rt.kind === "journal") {
      records = await parseJournals(file.name, buf);
    } else if (rt.medium === "print") {
      records = await parsePrintedBooks(file.name, buf);
    } else {
      records = await parseEbookTitles(file.name, buf);
    }
    send({ phase: "parsed", total: records.length });
    if (!records.length) {
      send({ phase: "done", received: 0, inserted: 0, skipped: 0 });
      return;
    }
    const db = serviceClient();

    // Pre-fetch existing titles of this format so re-uploads dedup.
    // Printed types dedup within the same campus only (so a Coron printed
    // copy doesn't block a Main Campus printed copy of the same call no).
    type Existing = { isbn: string; issn: string; call_no: string; title: string; author: string; year: string };
    const existing = await pageThrough<Existing>(
      (from, to) => {
        let q = db.from("titles")
          .select("isbn, issn, call_no, title, author, year")
          .eq("format", rt.id);
        if (rt.campusScoped) q = q.eq("campus", campus);
        return q.range(from, to) as unknown as PromiseLike<{ data: Existing[] | null; error: { message: string } | null }>;
      },
    );
    send({ phase: "deduping", existing: existing.length });

    const isbnSeen = new Set<string>();
    const issnSeen = new Set<string>();
    const tupleSeen = new Set<string>();
    for (const e of existing) {
      switch (rt.dedupBy) {
        case "isbn-or-tuple":
          if (e.isbn) isbnSeen.add(e.isbn);
          else tupleSeen.add(`${e.title}|${e.author}|${e.year}`);
          break;
        case "callno-title-author":
          tupleSeen.add(`${e.call_no}|${e.title}|${e.author}`);
          break;
        case "callno-title-issn":
          tupleSeen.add(`${e.call_no}|${e.title}|${e.issn}`);
          break;
        case "issn-or-title":
          if (e.issn) issnSeen.add(e.issn);
          else tupleSeen.add(e.title);
          break;
      }
    }

    const shouldKeep = (r: TitleRow): boolean => {
      switch (rt.dedupBy) {
        case "isbn-or-tuple": {
          const isbn = (r.isbn ?? "").trim();
          if (isbn) {
            if (isbnSeen.has(isbn)) return false;
            isbnSeen.add(isbn);
          } else {
            const key = `${r.title}|${r.author ?? ""}|${r.year ?? ""}`;
            if (tupleSeen.has(key)) return false;
            tupleSeen.add(key);
          }
          return true;
        }
        case "callno-title-author": {
          const key = `${r.call_no ?? ""}|${r.title}|${r.author ?? ""}`;
          if (tupleSeen.has(key)) return false;
          tupleSeen.add(key);
          return true;
        }
        case "callno-title-issn": {
          const key = `${r.call_no ?? ""}|${r.title}|${r.issn ?? ""}`;
          if (tupleSeen.has(key)) return false;
          tupleSeen.add(key);
          return true;
        }
        case "issn-or-title": {
          const issn = (r.issn ?? "").trim();
          if (issn) {
            if (issnSeen.has(issn)) return false;
            issnSeen.add(issn);
          } else {
            if (tupleSeen.has(r.title)) return false;
            tupleSeen.add(r.title);
          }
          return true;
        }
      }
    };

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batchInput = records.slice(i, i + BATCH);
      const toInsert = [];
      for (const r of batchInput) {
        if (!shouldKeep(r)) { skipped++; continue; }
        toInsert.push({
          format: rt.id,
          title: r.title,
          author: r.author ?? "",
          publisher: r.publisher ?? "",
          year: r.year ?? "",
          isbn: r.isbn ?? "",
          issn: r.issn ?? "",
          call_no: r.call_no ?? "",
          copies: r.copies ?? 1,
          url: r.url ?? "",
          subjects: r.subjects ?? "",
          campus,
        });
      }
      if (toInsert.length) {
        const { data, error } = await db.from("titles").insert(toInsert).select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
      }
      send({ phase: "inserting", inserted, skipped, total: records.length });
    }
    send({ phase: "done", received: records.length, inserted, skipped });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
