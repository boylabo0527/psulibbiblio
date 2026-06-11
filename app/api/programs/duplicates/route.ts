import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { normalizeForDedup } from "@/lib/dedup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProgramSummary = {
  id: number;
  name: string;
  subjects: number;
};

export async function GET() {
  try {
    const db = serviceClient();
    const { data: programs, error } = await db
      .from("programs")
      .select("id, name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: subjects, error: subErr } = await db
      .from("subjects")
      .select("program_id");
    if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });

    const subjectCounts = new Map<number, number>();
    for (const s of subjects ?? []) {
      subjectCounts.set(s.program_id, (subjectCounts.get(s.program_id) ?? 0) + 1);
    }

    const groups = new Map<string, ProgramSummary[]>();
    for (const p of programs ?? []) {
      const key = normalizeForDedup(p.name);
      if (!key) continue;
      const summary: ProgramSummary = {
        id: p.id,
        name: p.name,
        subjects: subjectCounts.get(p.id) ?? 0,
      };
      const list = groups.get(key) ?? [];
      list.push(summary);
      groups.set(key, list);
    }

    const dupes = Array.from(groups.entries())
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({
        normalized: key,
        programs: list.sort((a, b) => b.subjects - a.subjects || a.id - b.id),
      }));

    return NextResponse.json({ groups: dupes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
