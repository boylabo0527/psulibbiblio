import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";
import { loadProgramBibliography } from "@/lib/bibliography";
import { RESOURCE_TYPES } from "@/lib/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SubjectSearchRow = {
  subject_id: number;
  program_id: number;
  program: string;
  course_code: string;
  course_title: string;
  /** Assignments actually on this subject right now, broken down by
   *  format and whether they're locked (manual) -- lets an admin see
   *  directly whether a Match run's reported count actually landed here,
   *  without needing database access. Two subjects with confusingly
   *  similar names (a near-duplicate upload, or the same course listed
   *  under two programs) show up as separate rows with their own counts,
   *  which is usually the answer when "N matches assigned" doesn't seem
   *  to show up anywhere. */
  assignments: { format: string; manual: number; count: number }[];
  /** What loadProgramBibliography -- the exact function behind the on-screen
   *  Programs & Export page and every export format -- actually returns for
   *  this subject right now, run twice: once with no campus filter at all
   *  (isolates the raw fetch from any campus-matching question) and once
   *  with whatever campus this request was called with (?campus=...), if
   *  any. Comparing these two numbers against `assignments` above (the raw
   *  table count) pinpoints exactly which stage is dropping titles: if
   *  noCampusFilter is already short, the bug is in the fetch itself; if
   *  noCampusFilter is right but withCampusFilter isn't, it's the campus
   *  match; if both match `assignments`, the data's fine and the problem is
   *  somewhere client-side instead. */
  visibleViaBibliography: { noCampusFilter: number; withCampusFilter: number | null };
};

/** GET /api/subjects/search?q=... -- admin-only diagnostic: finds every
 *  subject whose course code or title contains q (case-insensitive), with
 *  its program and a live breakdown of what's actually in `assignments`
 *  for it right now. Exists for tracking down "Match said N titles were
 *  assigned but Programs & Export doesn't show them" -- the most common
 *  real cause is two subjects with the same/similar name (accidentally
 *  uploaded twice, or the same course under two programs), where a run
 *  against one doesn't show up under the other. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const params = new URL(req.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    const campusParam = (params.get("campus") ?? "").trim();
    if (!q) return NextResponse.json({ subjects: [] });

    const { data: subjects, error } = await db.from("subjects")
      .select("id, program_id, course_code, course_title")
      .or(`course_code.ilike.%${q}%,course_title.ilike.%${q}%`)
      .limit(50);
    if (error) throw error;
    if (!subjects?.length) return NextResponse.json({ subjects: [] });

    const programIds = Array.from(new Set(subjects.map((s) => s.program_id)));
    const { data: programRows } = await db.from("programs").select("id, name").in("id", programIds);
    const programMap = new Map((programRows ?? []).map((p) => [p.id, p.name as string]));

    const subjectIds = subjects.map((s) => s.id);
    type AssignRow = { subject_id: number; manual: number; titles: { format: string } | null };
    const { data: assignments, error: assignErr } = await db.from("assignments")
      .select("subject_id, manual, titles(format)")
      .in("subject_id", subjectIds) as unknown as { data: AssignRow[] | null; error: { message: string } | null };
    if (assignErr) throw new Error(assignErr.message);

    const countsBySubject = new Map<number, Map<string, number>>();
    for (const a of assignments ?? []) {
      if (!a.titles) continue;
      const key = `${a.titles.format}|${a.manual}`;
      if (!countsBySubject.has(a.subject_id)) countsBySubject.set(a.subject_id, new Map());
      const m = countsBySubject.get(a.subject_id)!;
      m.set(key, (m.get(key) ?? 0) + 1);
    }

    // Runs the actual, currently-deployed loadProgramBibliography for just
    // this one subject and counts how many titles it puts in that
    // subject's own buckets -- exercising the real production code path
    // instead of a guess at what it should do. Capped to the first 10
    // matches so a broad search term can't trigger dozens of extra
    // round trips.
    async function countViaBibliography(programId: number, subjectId: number, campus: string): Promise<number> {
      const biblio = await loadProgramBibliography(programId, campus, subjectId);
      const subj = biblio.bySection[0]?.subjects[0];
      if (!subj) return 0;
      return RESOURCE_TYPES.reduce((sum, t) => sum + (subj.buckets[t.id]?.length ?? 0), 0);
    }

    const rows: SubjectSearchRow[] = [];
    for (const [i, s] of subjects.entries()) {
      const m = countsBySubject.get(s.id) ?? new Map();
      const assignmentsOut = Array.from(m.entries()).map(([key, count]) => {
        const [format, manual] = key.split("|");
        return { format, manual: Number(manual), count };
      }).sort((a, b) => a.format.localeCompare(b.format));

      let visibleViaBibliography = { noCampusFilter: -1, withCampusFilter: null as number | null };
      if (i < 10) {
        const noCampusFilter = await countViaBibliography(s.program_id, s.id, "");
        const withCampusFilter = campusParam ? await countViaBibliography(s.program_id, s.id, campusParam) : null;
        visibleViaBibliography = { noCampusFilter, withCampusFilter };
      }

      rows.push({
        subject_id: s.id,
        program_id: s.program_id,
        program: programMap.get(s.program_id) ?? "",
        course_code: s.course_code ?? "",
        course_title: s.course_title,
        assignments: assignmentsOut,
        visibleViaBibliography,
      });
    }

    return NextResponse.json({ subjects: rows });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
