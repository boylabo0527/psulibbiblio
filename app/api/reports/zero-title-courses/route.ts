import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";
import { pageThrough } from "@/lib/paging";
import { yearInRange } from "@/lib/years";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ZeroTitleCampus = { id: number; name: string };
export type ZeroTitleRow = {
  campus_id: number;
  campus: string;
  program_id: number;
  program: string;
  course_id: number;
  course_code: string;
  course_title: string;
};

export type ZeroTitlesReportResponse =
  | { campuses: ZeroTitleCampus[]; rows: ZeroTitleRow[] }
  | { error: string };

/** GET /api/reports/zero-title-courses[?min_year=&max_year=] -- every
 *  (campus, course) pairing where that course currently has zero
 *  VALIDATED (librarian-locked, assignments.manual=1) titles -- or, when
 *  min_year/max_year are given, zero validated titles whose copyright
 *  year falls in that range. An auto-matched candidate that hasn't been
 *  reviewed/locked yet doesn't count as "having" a title here, matching
 *  how ProgramsTab's own "Validated" count already distinguishes "has
 *  any match" from "has a confirmed match."
 *
 *  A course appears once per campus its program is offered at (campus
 *  lives on the program via program_campuses, not on the course itself
 *  -- see lib/bibliography.ts's own comment on this). A program with no
 *  campus mapping yet still appears, under campus "" ("Unassigned"),
 *  the same "don't silently hide it" policy CustomReportsTab already
 *  uses for programs/courses outside any campus mapping. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["coverage-gaps"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const url = new URL(req.url);
    const minYearParam = url.searchParams.get("min_year");
    const maxYearParam = url.searchParams.get("max_year");
    const minYear = minYearParam ? parseInt(minYearParam, 10) : undefined;
    const maxYear = maxYearParam ? parseInt(maxYearParam, 10) : undefined;

    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;

    const { data: campusRows, error: campusErr } = await db.from("campuses").select("id, name").order("name");
    if (campusErr) throw campusErr;
    const campuses: ZeroTitleCampus[] = perms.campusIds !== null
      ? (campusRows ?? []).filter((c) => perms.campusIds!.includes(c.id))
      : (campusRows ?? []);
    const campusById = new Map(campuses.map((c) => [c.id, c.name]));

    const { data: mappingRows, error: mapErr } = await db.from("program_campuses").select("program_id, campus_id");
    if (mapErr) throw mapErr;
    const campusIdsByProgram = new Map<number, number[]>();
    for (const m of mappingRows ?? []) {
      if (!campusIdsByProgram.has(m.program_id)) campusIdsByProgram.set(m.program_id, []);
      campusIdsByProgram.get(m.program_id)!.push(m.campus_id);
    }

    const { data: programRows, error: progErr } = await db.from("programs").select("id, name").order("name");
    if (progErr) throw progErr;
    const programs = (programRows ?? []).filter((p) => allowedProgramIds === null || allowedProgramIds.has(p.id));
    const programById = new Map(programs.map((p) => [p.id, p.name]));
    const allowedProgramIdSet = new Set(programs.map((p) => p.id));

    type SubjectRec = { id: number; program_id: number; course_code: string | null; course_title: string | null };
    const subjectRows = await pageThrough<SubjectRec>(
      (from, to) => db.from("subjects").select("id, program_id, course_code, course_title")
        .order("program_id").order("sort_order")
        .range(from, to) as unknown as PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>,
    );
    const subjects = subjectRows.filter((s) => allowedProgramIdSet.has(s.program_id));
    const subjectIds = subjects.length ? subjects.map((s) => s.id) : [-1];

    // Only VALIDATED (manual=1) assignments establish coverage -- an
    // unreviewed auto-match doesn't count toward "this course has a
    // title" for a gap report meant to flag what still needs a
    // librarian's attention.
    type Joined = { subject_id: number; titles: { year: string | null } };
    const validated: Joined[] = [];
    for (let i = 0; i < subjectIds.length; i += 200) {
      const chunk = subjectIds.slice(i, i + 200);
      const chunkRows = await pageThrough<Joined>((from, to) =>
        db.from("assignments")
          .select("subject_id, titles!inner(year)")
          .in("subject_id", chunk)
          .eq("manual", 1)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: Joined[] | null; error: { message: string } | null }>,
      );
      validated.push(...chunkRows);
    }

    const validatedYearsBySubject = new Map<number, string[]>();
    for (const a of validated) {
      if (!validatedYearsBySubject.has(a.subject_id)) validatedYearsBySubject.set(a.subject_id, []);
      validatedYearsBySubject.get(a.subject_id)!.push(a.titles.year ?? "");
    }

    const hasCoverage = (subjectId: number): boolean => {
      const years = validatedYearsBySubject.get(subjectId);
      if (!years || years.length === 0) return false;
      if (minYear === undefined && maxYear === undefined) return true;
      return years.some((y) => yearInRange(y, minYear, maxYear));
    };

    const rows: ZeroTitleRow[] = [];
    for (const s of subjects) {
      if (hasCoverage(s.id)) continue;
      const programName = programById.get(s.program_id) ?? "";
      const cids = campusIdsByProgram.get(s.program_id) ?? [];
      const targets = cids.length ? cids : [0]; // 0 = "Unassigned" sentinel
      for (const cid of targets) {
        if (cid !== 0 && !campusById.has(cid)) continue; // outside this user's campus scope
        rows.push({
          campus_id: cid,
          campus: cid === 0 ? "" : (campusById.get(cid) ?? ""),
          program_id: s.program_id,
          program: programName,
          course_id: s.id,
          course_code: s.course_code ?? "",
          course_title: s.course_title ?? "",
        });
      }
    }

    return NextResponse.json({ campuses, rows } satisfies ZeroTitlesReportResponse);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) } satisfies ZeroTitlesReportResponse, { status: 500 });
  }
}
