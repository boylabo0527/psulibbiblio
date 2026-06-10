import { NextResponse } from "next/server";
import { parsePrintedBooks } from "@/lib/parsers";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BATCH = 500;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const records = await parsePrintedBooks(file.name, buf);
    if (!records.length) return NextResponse.json({ received: 0, inserted: 0 });

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
    }
    return NextResponse.json({ received: records.length, inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
