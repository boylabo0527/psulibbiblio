import { parseEbookTitles } from "@/lib/parsers";
import { pageThrough } from "@/lib/paging";
import { ndjsonStream } from "@/lib/streaming";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 500;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");

  const stream = ndjsonStream(async (send) => {
    if (!(file instanceof File)) throw new Error("Missing file");
    send({ phase: "parsing" });
    const buf = Buffer.from(await file.arrayBuffer());
    const records = await parseEbookTitles(file.name, buf);
    send({ phase: "parsed", total: records.length });
    if (!records.length) {
      send({ phase: "done", received: 0, inserted: 0, skipped: 0 });
      return;
    }
    const db = serviceClient();

    // Pre-fetch existing eBook ISBNs to skip duplicates from prior uploads.
    const existing = await pageThrough<{ isbn: string; title: string; author: string; year: string }>(
      (from, to) => db.from("titles")
        .select("isbn, title, author, year")
        .eq("format", "ebook")
        .range(from, to) as unknown as PromiseLike<{ data: { isbn: string; title: string; author: string; year: string }[] | null; error: { message: string } | null }>,
    );
    send({ phase: "deduping", existing: existing.length });
    const isbnSeen = new Set<string>();
    const tupleSeen = new Set<string>();
    for (const e of existing) {
      if (e.isbn) isbnSeen.add(e.isbn);
      else tupleSeen.add(`${e.title}|${e.author}|${e.year}`);
    }

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batchInput = records.slice(i, i + BATCH);
      const toInsert: ReturnType<typeof shapeRow>[] = [];
      for (const r of batchInput) {
        const isbn = (r.isbn ?? "").trim();
        if (isbn) {
          if (isbnSeen.has(isbn)) { skipped++; continue; }
          isbnSeen.add(isbn);
        } else {
          const key = `${r.title}|${r.author ?? ""}|${r.year ?? ""}`;
          if (tupleSeen.has(key)) { skipped++; continue; }
          tupleSeen.add(key);
        }
        toInsert.push(shapeRow(r));
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

function shapeRow(r: { title: string; author?: string; publisher?: string; year?: string; isbn?: string; url?: string; subjects?: string }) {
  return {
    format: "ebook" as const,
    title: r.title,
    author: r.author ?? "",
    publisher: r.publisher ?? "",
    year: r.year ?? "",
    isbn: r.isbn ?? "",
    call_no: "",
    copies: 1,
    url: r.url ?? "",
    subjects: r.subjects ?? "",
  };
}
