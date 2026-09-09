import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

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

    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
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

    const rows: SubjectSearchRow[] = subjects.map((s) => {
      const m = countsBySubject.get(s.id) ?? new Map();
      const assignmentsOut = Array.from(m.entries()).map(([key, count]) => {
        const [format, manual] = key.split("|");
        return { format, manual: Number(manual), count };
      }).sort((a, b) => a.format.localeCompare(b.format));
      return {
        subject_id: s.id,
        program_id: s.program_id,
        program: programMap.get(s.program_id) ?? "",
        course_code: s.course_code ?? "",
        course_title: s.course_title,
        assignments: assignmentsOut,
      };
    });

    return NextResponse.json({ subjects: rows });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
