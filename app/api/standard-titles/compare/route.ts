import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { standardTitleMatches } from "@/lib/standard-titles";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ComparisonEntry = {
  standard_title_id: number;
  title: string; author: string; year: string; isbn: string;
  matched: boolean;
};

export type ComparisonSubject = {
  subject_id: number;
  program_id: number;
  program: string;
  course_code: string;
  course_title: string;
  entries: ComparisonEntry[];
  matched_count: number;
  total_count: number;
};

/** GET /api/standard-titles/compare -- for every course with at least one
 *  standard title set, which of them are already in the catalog (matched
 *  to that course) vs. still missing -- the actual point of collecting a
 *  standard list in the first place. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["standard-titles"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;

    const { data: standardRows, error: stErr } = await db.from("standard_titles")
      .select("id, subject_id, title, author, year, isbn");
    if (stErr) throw stErr;
    if (!standardRows?.length) return NextResponse.json({ subjects: [] });

    const subjectIds = Array.from(new Set(standardRows.map((r) => r.subject_id)));
    const { data: subjects } = await db.from("subjects")
      .select("id, program_id, course_code, course_title").in("id", subjectIds);
    const subjectMap = new Map((subjects ?? []).map((s) => [s.id, s]));

    const { data: programRows } = await db.from("programs").select("id, name");
    const programMap = new Map((programRows ?? []).map((p) => [p.id, p.name]));

    type AssignRow = { subject_id: number; titles: { title: string; isbn: string } | null };
    const assignments: AssignRow[] = [];
    for (let i = 0; i < subjectIds.length; i += 200) {
      const chunk = subjectIds.slice(i, i + 200);
      // .order("id") is required for a multi-page chunk to come back
      // complete -- without a deterministic sort, Postgres doesn't
      // guarantee a row lands on the same page across repeated .range()
      // calls, so a row can fall into a gap between pages and never come
      // back at all (see lib/bibliography.ts for how this manifested).
      const rows = await pageThrough<AssignRow>(
        (from, to) => db.from("assignments")
          .select("subject_id, titles(title, isbn)")
          .in("subject_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: AssignRow[] | null; error: { message: string } | null }>,
      );
      assignments.push(...rows);
    }
    const catalogBySubject = new Map<number, { title: string; isbn: string }[]>();
    for (const a of assignments) {
      if (!a.titles) continue;
      if (!catalogBySubject.has(a.subject_id)) catalogBySubject.set(a.subject_id, []);
      catalogBySubject.get(a.subject_id)!.push(a.titles);
    }

    const bySubject = new Map<number, typeof standardRows>();
    for (const r of standardRows) {
      if (!bySubject.has(r.subject_id)) bySubject.set(r.subject_id, []);
      bySubject.get(r.subject_id)!.push(r);
    }

    const results: ComparisonSubject[] = [];
    for (const [subjectId, entries] of bySubject) {
      const subj = subjectMap.get(subjectId);
      if (!subj) continue;
      if (allowedProgramIds && !allowedProgramIds.has(subj.program_id)) continue;
      const catalog = catalogBySubject.get(subjectId) ?? [];
      const compared: ComparisonEntry[] = entries.map((e) => ({
        standard_title_id: e.id, title: e.title, author: e.author, year: e.year, isbn: e.isbn,
        matched: catalog.some((c) => standardTitleMatches(e, c)),
      }));
      results.push({
        subject_id: subjectId, program_id: subj.program_id, program: programMap.get(subj.program_id) ?? "",
        course_code: subj.course_code, course_title: subj.course_title,
        entries: compared,
        matched_count: compared.filter((c) => c.matched).length,
        total_count: compared.length,
      });
    }
    results.sort((a, b) => a.program.localeCompare(b.program) || a.course_code.localeCompare(b.course_code));

    return NextResponse.json({ subjects: results });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
