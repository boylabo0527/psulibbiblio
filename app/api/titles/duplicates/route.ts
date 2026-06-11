import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { normalizeForDedup } from "@/lib/dedup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TitleRow = {
  id: number;
  format: string;
  title: string;
  author: string;
  year: string;
  isbn: string;
  issn: string;
  call_no: string;
  copies: number;
  campus: string;
};

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const formatFilter = (u.searchParams.get("format") ?? "").trim();
    const db = serviceClient();

    const rows = await pageThrough<TitleRow>((from, to) => {
      let q = db
        .from("titles")
        .select("id, format, title, author, year, isbn, issn, call_no, copies, campus")
        .range(from, to);
      if (formatFilter) q = q.eq("format", formatFilter);
      return q as unknown as PromiseLike<{ data: TitleRow[] | null; error: { message: string } | null }>;
    });

    // Group within format by normalized title + author. Titles in different
    // formats are not collapsed: a printed copy and an eBook of the same
    // book are intentionally separate resources.
    const groups = new Map<string, TitleRow[]>();
    for (const r of rows) {
      const titleKey = normalizeForDedup(r.title);
      const authorKey = normalizeForDedup(r.author);
      if (!titleKey) continue;
      const key = `${r.format}${titleKey}${authorKey}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    const dupes = Array.from(groups.values())
      .filter((list) => list.length > 1)
      .map((list) => list.sort((a, b) => (b.copies ?? 0) - (a.copies ?? 0) || a.id - b.id))
      .sort((a, b) => b.length - a.length);

    return NextResponse.json({ groups: dupes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
