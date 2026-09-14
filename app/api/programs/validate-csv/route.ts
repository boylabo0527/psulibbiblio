import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { isProgramInScope } from "@/lib/campus-scope";
import { parseValidationRows, type ValidationRow } from "@/lib/parsers";
import { standardTitleMatches } from "@/lib/standard-titles";
import { errorMessage } from "@/lib/errors";
import { pageThrough } from "@/lib/paging";
import { RESOURCE_BY_ID, type ResourceTypeId } from "@/lib/resources";

// Supabase/PostgREST caps a single select at 1000 rows by default. A
// program with enough courses and assigned titles can blow past that on
// both queries below -- previously neither was paginated, so whichever
// rows landed past row 1000 (an arbitrary cut, not "the last courses")
// silently vanished from the comparison: their courses looked like the
// upload had "no effect" even though the CSV rows for them were fine.
// pageThrough re-fetches in 1000-row pages until a short page ends it, and
// subject ids are additionally chunked (200 at a time, matching the same
// pattern in /api/standard-titles/compare) to keep the `.in(...)` filter
// itself from growing unbounded on a program with many courses.
const SUBJECT_CHUNK = 200;

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
  /** Matches the upload confirmed and that aren't locked yet -- offered so
   *  they can be bulk-locked in one action, protecting them from a future
   *  Match run now that a reviewer has actually vetted them. */
  confirmed: ValidateCsvPreviewRow[];
  confirmedCount: number;
  coursesReviewed: number;
};

/** POST /api/programs/validate-csv -- preview only, no writes. Body:
 *  multipart/form-data with `file` (the CSV/XLSX), `program_id`, and an
 *  optional `subject_id` to scope the check to just that one course
 *  instead of every course in the program -- useful when only a single
 *  course's matches were sent out for review, or when re-checking one
 *  course after fixing it, rather than re-reviewing the whole program.
 *
 *  Workflow this supports: a librarian exports the Programs & Export CSV
 *  (title+description matching only gets you so far), has it reviewed --
 *  by an outside AI or a person -- for which matches actually belong, then
 *  re-uploads the reviewed copy here. Only courses that appear in the
 *  upload (and, if scoped, match the selected course) are touched; every
 *  current (non-locked) assignment for those courses that the upload
 *  doesn't confirm is proposed for removal.
 *
 *  Journals go through the same confirm/remove/lock preview, just matched
 *  differently: a journal row has no course code (it's program-wide, see
 *  programBibliographyCsv), so it's matched by title/ISSN against every
 *  journal currently assigned anywhere in the program instead of one
 *  course's assignments, and only when the upload isn't scoped to a single
 *  course (a program-wide subscription isn't "this course's" to review).
 *  Each of a journal's underlying per-course assignment rows still becomes
 *  its own toRemove/confirmed/lockedSkipped entry, same shape as a book's --
 *  bulk-locking or bulk-removing everything the preview returns then
 *  touches every one of them, the same all-at-once effect as the lock
 *  button on the journal itself (see toggleJournalLock in ProgramsTab). */
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
    const subjectIdParam = Number(form.get("subject_id"));
    const scopedSubjectId = Number.isFinite(subjectIdParam) && subjectIdParam > 0 ? subjectIdParam : undefined;
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

    type SubjectRow = { id: number; course_code: string | null; course_title: string; program_id: number };
    let subjects: SubjectRow[];
    if (scopedSubjectId) {
      const { data: subj, error } = await db.from("subjects")
        .select("id, course_code, course_title, program_id").eq("id", scopedSubjectId).maybeSingle();
      if (error) throw error;
      if (!subj || subj.program_id !== programId) {
        return NextResponse.json({ error: "Course not found in this program." }, { status: 404 });
      }
      subjects = [subj];
      // Rows for any other course in the file are out of scope, not
      // "unknown" -- silently ignored instead of reported, since a
      // course-scoped check is normally run against the same full-program
      // export, not a file trimmed to just this course.
      rows = (subj.course_code ?? "").trim()
        ? rows.filter((r) => r.course_code.trim().toLowerCase() === subj.course_code!.trim().toLowerCase())
        : [];
    } else {
      subjects = await pageThrough<SubjectRow>((from, to) =>
        db.from("subjects")
          .select("id, course_code, course_title, program_id").eq("program_id", programId)
          .range(from, to) as unknown as PromiseLike<{ data: SubjectRow[] | null; error: { message: string } | null }>,
      );
    }
    const subjectByCode = new Map(subjects
      .filter((s) => (s.course_code ?? "").trim())
      .map((s) => [s.course_code!.trim().toLowerCase(), s]));

    // A journal row (blank course_code, see parseValidationRows) doesn't
    // belong in the course-matching loop below at all -- it'd otherwise
    // just show up there as an "unknown course" with an empty code.
    const courseRows = rows.filter((r) => r.course_code);
    // Journals are program-wide, not tied to a course, so a single-course
    // scope has nothing to check them against -- reviewing one course
    // doesn't say anything about the program's journal subscriptions.
    const journalRows = scopedSubjectId ? [] : rows.filter((r) => !r.course_code && r.program);

    const rowsBySubject = new Map<number, ValidationRow[]>();
    const unknownCourses = new Set<string>();
    for (const r of courseRows) {
      const subj = subjectByCode.get(r.course_code.trim().toLowerCase());
      if (!subj) { unknownCourses.add(r.course_code); continue; }
      if (!rowsBySubject.has(subj.id)) rowsBySubject.set(subj.id, []);
      rowsBySubject.get(subj.id)!.push(r);
    }

    const subjectIds = Array.from(rowsBySubject.keys());
    const preview: ValidateCsvPreview = {
      toRemove: [], lockedSkipped: [], unresolvedRows: [], confirmed: [],
      unknownCourses: Array.from(unknownCourses),
      confirmedCount: 0, coursesReviewed: subjectIds.length,
    };
    if (!subjectIds.length && !journalRows.length) return NextResponse.json(preview);

    type Joined = { subject_id: number; title_id: number; manual: number; titles: { id: number; title: string; isbn: string } };
    const assignments: Joined[] = [];
    for (let i = 0; i < subjectIds.length; i += SUBJECT_CHUNK) {
      const chunk = subjectIds.slice(i, i + SUBJECT_CHUNK);
      // .order("id") is required for a multi-page chunk to come back
      // complete -- without a deterministic sort, Postgres doesn't
      // guarantee a row lands on the same page across repeated .range()
      // calls, so a row can fall into a gap between pages and never come
      // back at all (see lib/bibliography.ts for how this manifested).
      const rows = await pageThrough<Joined>((from, to) =>
        db.from("assignments")
          .select("subject_id, title_id, manual, titles!inner(id, title, isbn)")
          .in("subject_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: Joined[] | null; error: { message: string } | null }>,
      );
      assignments.push(...rows);
    }

    const assignmentsBySubject = new Map<number, Joined[]>();
    for (const a of assignments) {
      if (!assignmentsBySubject.has(a.subject_id)) assignmentsBySubject.set(a.subject_id, []);
      assignmentsBySubject.get(a.subject_id)!.push(a);
    }

    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    for (const subjectId of subjectIds) {
      const subj = subjectById.get(subjectId)!;
      const csvRows = rowsBySubject.get(subjectId)!;
      const current = assignmentsBySubject.get(subjectId) ?? [];
      const matchedRowIdx = new Set<number>();

      for (const a of current) {
        const matchIdx = csvRows.findIndex((r) => standardTitleMatches({ title: r.title, isbn: r.isbn }, { title: a.titles.title, isbn: a.titles.isbn ?? "" }));
        const match = matchIdx >= 0 ? csvRows[matchIdx] : undefined;
        if (match) matchedRowIdx.add(matchIdx);

        const entry: ValidateCsvPreviewRow = {
          subject_id: subjectId, course_code: subj.course_code ?? "", course_title: subj.course_title,
          title_id: a.title_id, title: a.titles.title,
        };

        const notApplicable = match ? match.verdict === false : true;
        if (!notApplicable) {
          preview.confirmedCount++;
          if (!a.manual) preview.confirmed.push(entry);
          continue;
        }

        if (a.manual) preview.lockedSkipped.push(entry);
        else preview.toRemove.push(entry);
      }

      csvRows.forEach((r, i) => {
        if (!matchedRowIdx.has(i)) preview.unresolvedRows.push({ course_code: subj.course_code ?? r.course_code, title: r.title });
      });
    }

    if (journalRows.length) {
      const { data: progRow } = await db.from("programs").select("name").eq("id", programId).maybeSingle();
      const programName = (progRow?.name ?? "").trim().toLowerCase();
      // A combined-programs export (see loadCombinedProgramBibliography)
      // tags a journal shared by more than one program as "Program A +
      // Program B" -- this program is in scope for the row either way.
      const rowBelongsHere = (rowProgram: string) => {
        if (!programName) return false;
        return rowProgram.trim().toLowerCase().split(" + ").map((s) => s.trim()).includes(programName);
      };
      const relevantJournalRows = journalRows.filter((r) => rowBelongsHere(r.program));

      if (relevantJournalRows.length) {
        // Every subject in the program, not just the ones mentioned in
        // course rows above -- a journal can be attached to any of them.
        type JournalJoined = {
          subject_id: number; title_id: number; manual: number;
          titles: { id: number; title: string; issn: string; format: string };
        };
        const allSubjectIds = subjects.map((s) => s.id);
        const journalAssignments: JournalJoined[] = [];
        for (let i = 0; i < allSubjectIds.length; i += SUBJECT_CHUNK) {
          const chunk = allSubjectIds.slice(i, i + SUBJECT_CHUNK);
          const rowsChunk = await pageThrough<JournalJoined>((from, to) =>
            db.from("assignments")
              .select("subject_id, title_id, manual, titles!inner(id, title, issn, format)")
              .in("subject_id", chunk)
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{ data: JournalJoined[] | null; error: { message: string } | null }>,
          );
          journalAssignments.push(...rowsChunk);
        }
        const journalOnly = journalAssignments.filter(
          (a) => RESOURCE_BY_ID[a.titles.format as ResourceTypeId]?.kind === "journal",
        );

        const matchedJournalRowIdx = new Set<number>();
        for (const a of journalOnly) {
          const matchIdx = relevantJournalRows.findIndex((r) =>
            standardTitleMatches({ title: r.title, isbn: r.isbn }, { title: a.titles.title, isbn: a.titles.issn ?? "" }));
          const match = matchIdx >= 0 ? relevantJournalRows[matchIdx] : undefined;
          if (match) matchedJournalRowIdx.add(matchIdx);

          // course_code left blank, course_title "(Program-wide)" -- same
          // convention programBibliographyCsv uses for a journal row, and
          // the client already falls back from course_code to course_title
          // when rendering these (see the toRemove table in ProgramsTab).
          const entry: ValidateCsvPreviewRow = {
            subject_id: a.subject_id, course_code: "", course_title: "(Program-wide)",
            title_id: a.title_id, title: a.titles.title,
          };

          const notApplicable = match ? match.verdict === false : true;
          if (!notApplicable) {
            preview.confirmedCount++;
            if (!a.manual) preview.confirmed.push(entry);
            continue;
          }

          if (a.manual) preview.lockedSkipped.push(entry);
          else preview.toRemove.push(entry);
        }

        relevantJournalRows.forEach((r, i) => {
          if (!matchedJournalRowIdx.has(i)) preview.unresolvedRows.push({ course_code: "(Program-wide)", title: r.title });
        });
      }
    }

    return NextResponse.json(preview);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
