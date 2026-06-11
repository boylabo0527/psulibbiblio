import { NextResponse } from "next/server";
import { runMatch } from "@/lib/matcher";
import { serviceClient } from "@/lib/supabase";
import type { SubjectRow, TitleRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 1000;

async function fetchAll<T>(
  db: ReturnType<typeof serviceClient>, table: string, columns: string,
  filter?: { col: string; value: number },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = q.eq(filter.col, filter.value);
    const { data, error } = await q;
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
    const programId = url.searchParams.get("program_id");
    const db = serviceClient();

    const subjects = await fetchAll<SubjectRow>(
      db, "subjects",
      "id, program_id, course_code, course_title, description",
      programId ? { col: "program_id", value: Number(programId) } : undefined,
    );
    const titles = await fetchAll<TitleRow>(
      db, "titles",
      "id, format, title, author, publisher, year, subjects",
    );
    if (!subjects.length || !titles.length) {
      return NextResponse.json(
        { error: "Need at least one subject and one title before matching." },
        { status: 400 },
      );
    }

    const results = runMatch(subjects, titles, { topK, minScore });

    // Drop prior auto assignments for these subjects; keep manual rows.
    const subjectIds = subjects.map((s) => s.id!);
    for (let i = 0; i < subjectIds.length; i += 200) {
      const slice = subjectIds.slice(i, i + 200);
      const { error } = await db.from("assignments")
        .delete().in("subject_id", slice).eq("manual", 0);
      if (error) throw error;
    }

    const rows = results.map((r) => ({
      subject_id: r.subject_id,
      title_id: r.title_id,
      score: r.score,
      rank: r.rank,
      explanation: r.explanation ?? "",
      manual: 0,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const slice = rows.slice(i, i + 1000);
      const { error } = await db.from("assignments")
        .upsert(slice, { onConflict: "subject_id,title_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    return NextResponse.json({
      matches: results.length,
      subjects: subjects.length,
      titles: titles.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
