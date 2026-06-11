import { NextResponse } from "next/server";
import { pageThrough } from "@/lib/paging";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List distinct campuses found on printed titles (Books + Journals). */
export async function GET() {
  try {
    const db = serviceClient();
    const rows = await pageThrough<{ campus: string }>(
      (from, to) => db.from("titles")
        .select("campus")
        .in("format", ["book_printed", "journal_printed"])
        .neq("campus", "")
        .range(from, to) as unknown as PromiseLike<{ data: { campus: string }[] | null; error: { message: string } | null }>,
    );
    const set = new Set<string>();
    for (const r of rows) {
      const c = (r.campus ?? "").trim();
      if (c) set.add(c);
    }
    return NextResponse.json({ campuses: Array.from(set).sort() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}
