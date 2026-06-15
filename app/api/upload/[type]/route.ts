import { parseEbookTitles, parseJournals, parsePrintedBooks, buildTitleRowsFromRaw } from "@/lib/parsers";
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
  // Accept either pre-parsed JSON rows (sent by the browser after client-side
  // spreadsheet parsing) or a raw file via multipart/form-data.
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");

  let campusInput = "";
  let preRows: Record<string, string>[] | null = null;
  let file: File | null = null;

  if (isJson) {
    const body = await req.json() as { rows: Record<string, string>[]; filename?: string; campus?: string };
    preRows = body.rows ?? [];
    campusInput = (body.campus ?? "").trim();
    // Create a dummy filename for format detection in buildTitleRowsFromRaw
    file = { name: body.filename ?? "upload.xlsx" } as File;
  } else {
    const form = await req.formData();
    file = form.get("file") as File | null;
    campusInput = ((form.get("campus") as string | null) ?? "").trim();
  }

  const stream = ndjsonStream(async (send) => {
    if (!isResourceTypeId(params.type)) {
      throw new Error(`Unknown resource type: ${params.type}`);
    }
    const rt = RESOURCE_BY_ID[params.type];
    if (!file) throw new Error("Missing file");
    const defaultCampus = rt.campusScoped ? campusInput : "";
    send({ phase: "parsing" });

    let records: TitleRow[];
    if (preRows) {
      // Client already parsed the spreadsheet; just apply column aliases.
      records = buildTitleRowsFromRaw(file.name, preRows, rt);
    } else {
      const buf = Buffer.from(await (file as File).arrayBuffer());
      if (rt.kind === "journal") {
        records = await parseJournals(file.name, buf);
      } else if (rt.medium === "print") {
        records = await parsePrintedBooks(file.name, buf);
      } else {
        records = await parseEbookTitles(file.name, buf);
      }
    }
    send({ phase: "parsed", total: records.length });
    if (!records.length) {
      send({ phase: "done", received: 0, inserted: 0, skipped: 0 });
      return;
    }
    const db = serviceClient();

    const rowCampus = (r: TitleRow): string => {
      if (!rt.campusScoped) return "";
      const fromRow = (r.campus ?? "").trim();
      return fromRow || defaultCampus;
    };

    // Validate campus on all rows up front.
    for (const r of records) {
      const c = rowCampus(r);
      if (rt.campusScoped && !c) {
        throw new Error(
          `Row "${r.title}" has no campus — set a campus in the upload card or add a "Campus" column to the file.`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Accession mode (Printed Books): each row = 1 physical copy.
    // Rows with the same call_no+title+author+campus within the file are
    // aggregated (copies summed). Titles already in the DB get their copy
    // count incremented rather than skipped.
    // -----------------------------------------------------------------------
    if (rt.accessionMode) {
      // Step 1: aggregate incoming rows by key, summing copies.
      const keyOf = (r: TitleRow, c: string) =>
        `${(r.call_no ?? "").trim()}|${r.title.trim()}|${(r.author ?? "").trim()}|${c}`;

      type AggRow = { row: TitleRow; campus: string; copies: number };
      const aggMap = new Map<string, AggRow>();
      for (const r of records) {
        const c = rowCampus(r);
        const k = keyOf(r, c);
        const agg = aggMap.get(k);
        if (agg) {
          agg.copies += r.copies ?? 1;
        } else {
          aggMap.set(k, { row: r, campus: c, copies: r.copies ?? 1 });
        }
      }

      // Step 2: fetch existing titles with id + copies so we can increment.
      type Existing = { id: number; call_no: string; title: string; author: string; campus: string; copies: number };
      const existing = await pageThrough<Existing>(
        (from, to) => db.from("titles")
          .select("id, call_no, title, author, campus, copies")
          .eq("format", rt.id)
          .range(from, to) as unknown as PromiseLike<{ data: Existing[] | null; error: { message: string } | null }>,
      );
      send({ phase: "deduping", existing: existing.length });

      const existingMap = new Map<string, Existing>();
      for (const e of existing) {
        existingMap.set(`${(e.call_no ?? "").trim()}|${e.title.trim()}|${(e.author ?? "").trim()}|${e.campus ?? ""}`, e);
      }

      // Step 3: split aggregated rows into inserts vs copy-count updates.
      const toInsert: Record<string, unknown>[] = [];
      const toUpdate: { id: number; copies: number }[] = [];

      for (const [k, { row, campus: c, copies }] of aggMap) {
        const ex = existingMap.get(k);
        if (ex) {
          toUpdate.push({ id: ex.id, copies: ex.copies + copies });
        } else {
          const row2: Record<string, unknown> = {
            format: rt.id,
            title: row.title,
            author: row.author ?? "",
            publisher: row.publisher ?? "",
            year: row.year ?? "",
            isbn: row.isbn ?? "",
            issn: row.issn ?? "",
            call_no: row.call_no ?? "",
            copies,
            url: row.url ?? "",
            subjects: row.subjects ?? "",
            campus: c,
          };
          toInsert.push(row2);
        }
      }

      let inserted = 0;
      let updated = 0;

      // Batch inserts.
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const slice = toInsert.slice(i, i + BATCH);
        const { data, error } = await db.from("titles").insert(slice).select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
        send({ phase: "inserting", inserted, skipped: updated, total: aggMap.size });
      }

      // Batch copy-count updates (one per row; group into chunks to avoid too many requests).
      for (let i = 0; i < toUpdate.length; i += BATCH) {
        const slice = toUpdate.slice(i, i + BATCH);
        for (const { id, copies } of slice) {
          const { error } = await db.from("titles").update({ copies }).eq("id", id);
          if (error) throw error;
          updated++;
        }
        send({ phase: "inserting", inserted, skipped: updated, total: aggMap.size });
      }

      send({ phase: "done", received: records.length, inserted, skipped: updated });
      return;
    }

    // -----------------------------------------------------------------------
    // Standard dedup mode (all other resource types).
    // -----------------------------------------------------------------------
    type Existing = { isbn: string; issn: string; call_no: string; title: string; author: string; year: string; campus: string };
    const selectCols = rt.campusScoped
      ? "isbn, issn, call_no, title, author, year, campus"
      : "isbn, issn, call_no, title, author, year";
    const existing = await pageThrough<Existing>(
      (from, to) => db.from("titles")
        .select(selectCols)
        .eq("format", rt.id)
        .range(from, to) as unknown as PromiseLike<{ data: Existing[] | null; error: { message: string } | null }>,
    );
    send({ phase: "deduping", existing: existing.length });

    const isbnSeen = new Set<string>();
    const issnSeen = new Set<string>();
    const tupleSeen = new Set<string>();
    const campusKey = (c: string) => (rt.campusScoped ? `|${c}` : "");
    for (const e of existing) {
      switch (rt.dedupBy) {
        case "isbn-or-tuple":
          if (e.isbn) isbnSeen.add(e.isbn);
          else tupleSeen.add(`${e.title}|${e.author}|${e.year}`);
          break;
        case "callno-title-author":
          tupleSeen.add(`${e.call_no}|${e.title}|${e.author}${campusKey(e.campus ?? "")}`);
          break;
        case "callno-title-issn":
          tupleSeen.add(`${e.call_no}|${e.title}|${e.issn}${campusKey(e.campus ?? "")}`);
          break;
        case "issn-or-title":
          if (e.issn) issnSeen.add(e.issn);
          else tupleSeen.add(e.title);
          break;
      }
    }

    const shouldKeep = (r: TitleRow, c: string): boolean => {
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
          const key = `${r.call_no ?? ""}|${r.title}|${r.author ?? ""}${campusKey(c)}`;
          if (tupleSeen.has(key)) return false;
          tupleSeen.add(key);
          return true;
        }
        case "callno-title-issn": {
          const key = `${r.call_no ?? ""}|${r.title}|${r.issn ?? ""}${campusKey(c)}`;
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
        const c = rowCampus(r);
        if (!shouldKeep(r, c)) { skipped++; continue; }
        const row: Record<string, unknown> = {
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
        };
        if (rt.campusScoped) row.campus = c;
        toInsert.push(row);
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
