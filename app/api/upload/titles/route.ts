import { NextResponse } from "next/server";
import { parseTitles } from "@/lib/parsers";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 500;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const records = await parseTitles(file.name, buf);
    if (records.length === 0) {
      return NextResponse.json({ received: 0, inserted: 0, skipped: 0 });
    }
    const db = serviceClient();

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const slice = records.slice(i, i + BATCH).map((r) => ({
        title: r.title,
        author: r.author ?? "",
        publisher: r.publisher ?? "",
        year: r.year ?? "",
        isbn: r.isbn ?? "",
        edition: r.edition ?? "",
        url: r.url ?? "",
        subjects: r.subjects ?? "",
      }));
      // Use upsert keyed by isbn when available; otherwise plain insert.
      const withIsbn = slice.filter((r) => r.isbn);
      const noIsbn = slice.filter((r) => !r.isbn);
      if (withIsbn.length) {
        const { data, error } = await db
          .from("titles")
          .upsert(withIsbn, { onConflict: "isbn", ignoreDuplicates: true })
          .select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
        skipped += withIsbn.length - (data?.length ?? 0);
      }
      if (noIsbn.length) {
        const { data, error } = await db.from("titles").insert(noIsbn).select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
      }
    }
    return NextResponse.json({ received: records.length, inserted, skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
