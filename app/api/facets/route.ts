import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 1000;

async function distinct(
  db: ReturnType<typeof serviceClient>,
  table: string,
  column: string,
): Promise<string[]> {
  const seen = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(column).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as unknown as Array<Record<string, unknown>>) {
      const v = (row[column] ?? "") as string;
      if (v) seen.add(v);
    }
    if (data.length < PAGE) break;
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export async function GET() {
  try {
    const db = serviceClient();
    const [campus, college, program, author, publisher, year] = await Promise.all([
      distinct(db, "courses", "campus"),
      distinct(db, "courses", "college"),
      distinct(db, "courses", "program"),
      distinct(db, "titles", "author"),
      distinct(db, "titles", "publisher"),
      distinct(db, "titles", "year"),
    ]);
    return NextResponse.json({ campus, college, program, author, publisher, year });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
