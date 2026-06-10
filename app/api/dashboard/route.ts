import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 1000;

export async function GET() {
  try {
    const db = serviceClient();
    const [{ count: cCount }, { count: tCount }, { count: mCount }] = await Promise.all([
      db.from("courses").select("*", { count: "exact", head: true }),
      db.from("titles").select("*", { count: "exact", head: true }),
      db.from("matches").select("*", { count: "exact", head: true }),
    ]);

    type Row = { titles: { publisher: string }; courses: { program: string }; title_id: number };
    const all: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("matches")
        .select("title_id, titles!inner(publisher), courses!inner(program)")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...(data as unknown as Row[]));
      if (data.length < PAGE) break;
    }

    const matchedTitles = new Set(all.map((r) => r.title_id));
    const pubCounts = new Map<string, number>();
    const titlePrograms = new Map<number, Set<string>>();
    const titleNames = new Map<number, string>();
    for (const r of all) {
      const p = r.titles.publisher;
      if (p) pubCounts.set(p, (pubCounts.get(p) ?? 0) + 1);
      const set = titlePrograms.get(r.title_id) ?? new Set<string>();
      set.add(r.courses.program ?? "");
      titlePrograms.set(r.title_id, set);
    }
    // Resolve title names for cross-program list.
    const ids = [...titlePrograms.entries()].filter(([, p]) => p.size > 1).map(([id]) => id);
    if (ids.length) {
      const { data } = await db.from("titles").select("id,title").in("id", ids);
      for (const row of (data ?? []) as Array<{ id: number; title: string }>) {
        titleNames.set(row.id, row.title);
      }
    }

    const topPublishers = [...pubCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([publisher, count]) => ({ publisher, count }));

    const crossProgramTitles = [...titlePrograms.entries()]
      .filter(([, p]) => p.size > 1)
      .map(([id, p]) => ({ title: titleNames.get(id) ?? `#${id}`, programs: p.size }))
      .sort((a, b) => b.programs - a.programs)
      .slice(0, 10);

    return NextResponse.json({
      totals: {
        courses: cCount ?? 0,
        titles: tCount ?? 0,
        matches: mCount ?? 0,
        matched_titles: matchedTitles.size,
      },
      top_publishers: topPublishers,
      cross_program_titles: crossProgramTitles,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
