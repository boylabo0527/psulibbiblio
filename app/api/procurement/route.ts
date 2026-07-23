import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import type { ResourceTypeId } from "@/lib/resources";

const ACCREDITATION_MIN = 5;          // minimum unique titles per subject for full compliance
const PARTIAL_MIN = 3;                // minimum recent titles to count as partial compliance
const RECENCY_YEARS = 5;              // titles must be published within last N years

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ProcurementRow = {
  subject_id: number;
  program_id: number;
  program: string;
  course_code: string;
  course_title: string;
  sort_order: number;
  counts: Record<ResourceTypeId, number>;
  total_titles: number;       // all titles regardless of year
  total_volumes: number;
  recent_titles: number;      // titles published within last RECENCY_YEARS years
  recent_year_cutoff: number; // the cutoff year (currentYear - RECENCY_YEARS)
  gap: number;                // shortfall based on recent titles (0 = compliant)
  compliant: boolean;         // recent_titles >= ACCREDITATION_MIN
  partial: boolean;           // recent_titles >= PARTIAL_MIN but < ACCREDITATION_MIN
};

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const programId = u.searchParams.get("program_id");
    const campus = (u.searchParams.get("campus") ?? "").trim();
    const db = serviceClient();

    const currentYear = new Date().getFullYear();
    const yearCutoff = currentYear - RECENCY_YEARS; // e.g. 2026 - 5 = 2021

    type SubjectRec = { id: number; program_id: number; course_code: string; course_title: string; sort_order: number };
    const subjects = await pageThrough<SubjectRec>(
      (from, to) => {
        let q = db.from("subjects")
          .select("id, program_id, course_code, course_title, sort_order")
          .order("program_id").order("sort_order").range(from, to);
        if (programId) q = q.eq("program_id", Number(programId));
        return q as unknown as PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>;
      },
    );

    if (!subjects.length) return NextResponse.json({ rows: [] });

    const { data: programRows } = await db.from("programs").select("id, name");
    const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));

    // Include year in title fetch so we can apply recency filter
    type AssignRow = { subject_id: number; titles: { format: string; campus: string; copies: number; year: string | null } | null };
    const subjectIds = subjects.map((s) => s.id);
    const assignments: AssignRow[] = [];
    for (let i = 0; i < subjectIds.length; i += 200) {
      const chunk = subjectIds.slice(i, i + 200);
      const rows = await pageThrough<AssignRow>(
        (from, to) => db.from("assignments")
          .select("subject_id, titles(format, campus, copies, year)")
          .in("subject_id", chunk)
          .range(from, to) as unknown as PromiseLike<{ data: AssignRow[] | null; error: { message: string } | null }>,
      );
      assignments.push(...rows);
    }

    const countMap = new Map<number, Record<string, number>>();
    const recentCountMap = new Map<number, number>(); // titles within recency window
    const volumeMap = new Map<number, number>();

    for (const a of assignments) {
      const t = a.titles;
      if (!t) continue;
      const isCampusScoped = t.format === "book_printed" || t.format === "journal_printed";
      if (isCampusScoped && campus && t.campus !== campus) continue;

      const sid = a.subject_id;
      if (!countMap.has(sid)) countMap.set(sid, {});
      const c = countMap.get(sid)!;
      c[t.format] = (c[t.format] ?? 0) + 1;

      const vol = isCampusScoped ? Math.max(1, t.copies ?? 1) : 1;
      volumeMap.set(sid, (volumeMap.get(sid) ?? 0) + vol);

      // Count recent titles: year must be a valid number >= yearCutoff
      const titleYear = parseInt(t.year ?? "", 10);
      if (!isNaN(titleYear) && titleYear >= yearCutoff) {
        recentCountMap.set(sid, (recentCountMap.get(sid) ?? 0) + 1);
      }
    }

    const rows: ProcurementRow[] = subjects.map((s) => {
      const counts = (countMap.get(s.id) ?? {}) as Record<ResourceTypeId, number>;
      const total_titles = Object.values(counts).reduce((a, b) => a + b, 0);
      const total_volumes = volumeMap.get(s.id) ?? total_titles;
      const recent_titles = recentCountMap.get(s.id) ?? 0;
      // Gap is based on recent titles only — must have 5 recent titles
      const gap = Math.max(0, ACCREDITATION_MIN - recent_titles);
      const compliant = recent_titles >= ACCREDITATION_MIN;
      return {
        subject_id: s.id,
        program_id: s.program_id,
        program: programMap.get(s.program_id) ?? "",
        course_code: s.course_code,
        course_title: s.course_title,
        sort_order: s.sort_order,
        counts,
        total_titles,
        total_volumes,
        recent_titles,
        recent_year_cutoff: yearCutoff,
        gap,
        compliant,
        partial: !compliant && recent_titles >= PARTIAL_MIN,
      };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
