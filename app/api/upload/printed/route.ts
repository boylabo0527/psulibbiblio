import { parsePrintedBooks } from "@/lib/parsers";
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
    const records = await parsePrintedBooks(file.name, buf);
    send({ phase: "parsed", total: records.length });
    if (!records.length) {
      send({ phase: "done", received: 0, inserted: 0, skipped: 0 });
      return;
    }
    const db = serviceClient();

    // Dedup key: (call_no | title | author). Skips re-uploaded rows.
    const existing = await pageThrough<{ call_no: string; title: string; author: string }>(
      (from, to) => db.from("titles")
        .select("call_no, title, author")
        .eq("format", "printed")
        .range(from, to) as unknown as PromiseLike<{ data: { call_no: string; title: string; author: string }[] | null; error: { message: string } | null }>,
    );
    send({ phase: "deduping", existing: existing.length });
    const seen = new Set(existing.map((e) => `${e.call_no}|${e.title}|${e.author}`));

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batchInput = records.slice(i, i + BATCH);
      const toInsert: ReturnType<typeof shapeRow>[] = [];
      for (const r of batchInput) {
        const key = `${r.call_no ?? ""}|${r.title}|${r.author ?? ""}`;
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
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

function shapeRow(r: { title: string; author?: string; publisher?: string; year?: string; isbn?: string; call_no?: string; copies?: number }) {
  return {
    format: "printed" as const,
    title: r.title,
    author: r.author ?? "",
    publisher: r.publisher ?? "",
    year: r.year ?? "",
    isbn: r.isbn ?? "",
    call_no: r.call_no ?? "",
    copies: r.copies ?? 1,
    url: "",
    subjects: "",
  };
}
