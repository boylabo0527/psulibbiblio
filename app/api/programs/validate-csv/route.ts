import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { isProgramInScope } from "@/lib/campus-scope";
import { parseValidationRows, type ValidationRow } from "@/lib/parsers";
import { standardTitleMatches } from "@/lib/standard-titles";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type ValidateCsvPreviewRow = {
  subject_id: number;
  course_code: string;
  course_title: string;
  title_id: number;
  title: string;
};

export type ValidateCsvPreview = {
  /** Assignments that would be removed -- either the CSV explicitly marked
   *  them "not applicable", or (with no verdict column) the CSV's row set
   *  for that course simply never mentioned them. */
  toRemove: ValidateCsvPreviewRow[];
  /** Same shape, but skipped because the match is locked (manual=1) --
   *  locking exists specifically so a match survives review passes like
   *  this one. Reported so it isn't silently ignored. */
  lockedSkipped: ValidateCsvPreviewRow[];
  /** CSV rows that named a real course in this program but no currently
   *  assigned title matched them by ISBN/title -- most likely a title the
   *  reviewer added that was never actually in the catalog/course. */
  unresolvedRows: { course_code: string; title: string }[];
  /** Course codes present in the CSV that don't exist in this program. */
  unknownCourses: string[];
  confirmedCount: number;
  coursesReviewed: number;
};

/** POST /api/programs/validate-csv -- preview only, no writes. Body:
 *  multipart/form-data with `file` (the CSV/XLSX) and `program_id`.
 *
 *  Workflow this supports: a librarian exports the Programs & Export CSV
 *  (title+description matching only gets you so far), has it reviewed --
 *  by an outside AI or a person -- for which matches actually belong, then
 *  re-uploads the reviewed copy here. Only courses that appear in the
 *  upload are touched; every current (non-locked) assignment for those
 *  courses that the upload doesn't confirm is proposed for removal. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const programId = Number(form.get("program_id"));
    if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    if (!programId) return NextResponse.json({ error: "program_id is required." }, { status: 400 });
    if (!(await isProgramInScope(db, perms, programId))) {
      return NextResponse.json({ error: "This program isn't offered at any of your assigned campuses." }, { status: 403 });
    }

    let rows: ValidationRow[];
    try {
      rows = await parseValidationRows(file.name, Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
    }
    if (!rows.length) {
      return NextResponse.json({ error: "No usable rows found -- need at least Course Code and Title columns." }, { status: 400 });
    }

    const { data: subjects, error: subjErr } = await db.from("subjects")
      .select("id, course_code, course_title").eq("program_id", programId);
    if (subjErr) throw subjErr;
    const subjectByCode = new Map((subjects ?? [])
      .filter((s) => (s.course_code ?? "").trim())
      .map((s) => [s.course_code!.trim().toLowerCase(), s]));

    const rowsBySubject = new Map<number, ValidationRow[]>();
    const unknownCourses = new Set<string>();
    for (const r of rows) {
      const subj = subjectByCode.get(r.course_code.trim().toLowerCase());
      if (!subj) { unknownCourses.add(r.course_code); continue; }
      if (!rowsBySubject.has(subj.id)) rowsBySubject.set(subj.id, []);
      rowsBySubject.get(subj.id)!.push(r);
    }

    const subjectIds = Array.from(rowsBySubject.keys());
    const preview: ValidateCsvPreview = {
      toRemove: [], lockedSkipped: [], unresolvedRows: [],
      unknownCourses: Array.from(unknownCourses),
      confirmedCount: 0, coursesReviewed: subjectIds.length,
    };
    if (!subjectIds.length) return NextResponse.json(preview);

    type Joined = { subject_id: number; title_id: number; manual: number; titles: { id: number; title: string; isbn: string } };
    const { data: assignments, error: assignErr } = await db.from("assignments")
      .select("subject_id, title_id, manual, titles!inner(id, title, isbn)")
      .in("subject_id", subjectIds) as unknown as { data: Joined[] | null; error: { message: string } | null };
    if (assignErr) throw new Error(assignErr.message);

    for (const subjectId of subjectIds) {
      const subj = subjects!.find((s) => s.id === subjectId)!;
      const csvRows = rowsBySubject.get(subjectId)!;
      const current = (assignments ?? []).filter((a) => a.subject_id === subjectId);
      const matchedRowIdx = new Set<number>();

      for (const a of current) {
        const matchIdx = csvRows.findIndex((r) => standardTitleMatches({ title: r.title, isbn: r.isbn }, { title: a.titles.title, isbn: a.titles.isbn ?? "" }));
        const match = matchIdx >= 0 ? csvRows[matchIdx] : undefined;
        if (match) matchedRowIdx.add(matchIdx);

        const notApplicable = match ? match.verdict === false : true;
        if (!notApplicable) { preview.confirmedCount++; continue; }

        const entry: ValidateCsvPreviewRow = {
          subject_id: subjectId, course_code: subj.course_code ?? "", course_title: subj.course_title,
          title_id: a.title_id, title: a.titles.title,
        };
        if (a.manual) preview.lockedSkipped.push(entry);
        else preview.toRemove.push(entry);
      }

      csvRows.forEach((r, i) => {
        if (!matchedRowIdx.has(i)) preview.unresolvedRows.push({ course_code: subj.course_code ?? r.course_code, title: r.title });
      });
    }

    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
