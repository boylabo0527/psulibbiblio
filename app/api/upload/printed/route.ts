import { parsePrintedBooks } from "@/lib/parsers";
import { ndjsonStream } from "@/lib/streaming";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
      send({ phase: "done", received: 0, inserted: 0 });
      return;
    }
    const db = serviceClient();
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const slice = records.slice(i, i + BATCH).map((r) => ({
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
      }));
      const { data, error } = await db.from("titles").insert(slice).select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
      send({ phase: "inserting", inserted, total: records.length });
    }
    send({ phase: "done", received: records.length, inserted });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
