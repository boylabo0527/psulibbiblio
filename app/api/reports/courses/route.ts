import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";
import { pageThrough } from "@/lib/paging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ReportCampus = { id: number; name: string };
export type ReportProgram = { id: number; name: string; campus_ids: number[] };
export type ReportCourse = {
  id: number; program_id: number; course_code: string; course_title: string; description: string;
};

/** GET /api/reports/courses -- everything needed to build a custom
 *  campus/program/course report client-side: every campus, every program
 *  (with which campuses offer it), and every course (subject) with its
 *  description. Filtering/selection happens in the UI, not here -- the
 *  dataset is the same shape either way, just picked over interactively
 *  (see CustomReportsTab.tsx), the same relationship the TOR generator has
 *  to its own filtered item list. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["reports"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;

    const { data: campusRows, error: campusErr } = await db.from("campuses").select("id, name").order("name");
    if (campusErr) throw campusErr;
    const campuses: ReportCampus[] = (perms.campusIds !== null
      ? (campusRows ?? []).filter((c) => perms.campusIds!.includes(c.id))
      : campusRows ?? []);

    const { data: mappingRows, error: mapErr } = await db.from("program_campuses").select("program_id, campus_id");
    if (mapErr) throw mapErr;
    const campusIdsByProgram = new Map<number, number[]>();
    for (const m of mappingRows ?? []) {
      if (!campusIdsByProgram.has(m.program_id)) campusIdsByProgram.set(m.program_id, []);
      campusIdsByProgram.get(m.program_id)!.push(m.campus_id);
    }

    const { data: programRows, error: progErr } = await db.from("programs").select("id, name").order("name");
    if (progErr) throw progErr;
    const programs: ReportProgram[] = (programRows ?? [])
      .filter((p) => allowedProgramIds === null || allowedProgramIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, campus_ids: campusIdsByProgram.get(p.id) ?? [] }));
    const allowedProgramIdSet = new Set(programs.map((p) => p.id));

    type SubjectRec = { id: number; program_id: number; course_code: string; course_title: string; description: string | null };
    const subjectRows = await pageThrough<SubjectRec>(
      (from, to) => db.from("subjects").select("id, program_id, course_code, course_title, description")
        .order("program_id").order("sort_order")
        .range(from, to) as unknown as PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>,
    );
    const courses: ReportCourse[] = subjectRows
      .filter((s) => allowedProgramIdSet.has(s.program_id))
      .map((s) => ({
        id: s.id, program_id: s.program_id, course_code: s.course_code ?? "",
        course_title: s.course_title ?? "", description: s.description ?? "",
      }));

    return NextResponse.json({ campuses, programs, courses });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
