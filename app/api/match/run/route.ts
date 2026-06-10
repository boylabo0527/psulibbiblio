import { NextResponse } from "next/server";
import { runMatch } from "@/lib/matcher";
import { serviceClient } from "@/lib/supabase";
import type { CourseRow, TitleRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 1000;

async function fetchAll<T>(db: ReturnType<typeof serviceClient>, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const topK = parseInt(url.searchParams.get("top_k") ?? "10", 10);
    const minScore = parseFloat(url.searchParams.get("min_score") ?? "0.05");
    const db = serviceClient();
    const courses = await fetchAll<CourseRow>(db, "courses",
      "id,campus,college,program,major,course_title,description,learning_outcomes,keywords,enrollment");
    const titles = await fetchAll<TitleRow>(db, "titles",
      "id,title,author,publisher,subjects");

    if (!courses.length || !titles.length) {
      return NextResponse.json(
        { error: "Need at least one course and one title before matching." },
        { status: 400 },
      );
    }

    const results = runMatch(courses, titles, { topK, minScore });

    // Wipe prior auto matches; keep manual overrides.
    const { error: delErr } = await db.from("matches").delete().eq("overridden", 0);
    if (delErr) throw delErr;

    // Upsert new matches; on (course_id,title_id) conflict, leave existing row.
    const rows = results.map((r) => ({
      course_id: r.course_id,
      title_id: r.title_id,
      score: r.score,
      rank: r.rank,
      explanation: r.explanation ?? "",
      overridden: 0,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const slice = rows.slice(i, i + 1000);
      const { error } = await db
        .from("matches")
        .upsert(slice, { onConflict: "course_id,title_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    return NextResponse.json({
      matches: results.length,
      courses: courses.length,
      titles: titles.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
