/**
 * Core title-to-course/journal matching logic behind Validate Matches CSV --
 * shared between the single-program preview (/api/programs/validate-csv)
 * and the system-wide, cross-program validate job (lib/validate-jobs.ts).
 * Kept here as its own function (rather than having the job call into the
 * route, or the route import a refactored version of its own logic) so
 * neither one risks the other's behavior changing out from under it.
 */
import type { serviceClient } from "./supabase";
import { pageThrough } from "./paging";
import { RESOURCE_BY_ID, type ResourceTypeId } from "./resources";
import { standardTitleMatches } from "./standard-titles";
import type { ValidationRow } from "./parsers";

const SUBJECT_CHUNK = 200;

export type MatchPreviewRow = {
  subject_id: number; course_code: string; course_title: string;
  title_id: number; title: string;
};

export type ProgramMatchPreview = {
  toRemove: MatchPreviewRow[];
  lockedSkipped: MatchPreviewRow[];
  confirmed: MatchPreviewRow[];
  unresolvedRows: { course_code: string; title: string }[];
  unknownCourses: string[];
};

/** Checks one program's current course + journal matches against a CSV's
 *  rows for that program (courseRows keyed by course code, journalRows
 *  program-wide with no course code -- see parseValidationRows), the same
 *  confirm/remove/lock rules /api/programs/validate-csv applies for a
 *  single program: a current match with no CSV row confirming it (or an
 *  explicit "no" verdict) is proposed for removal unless it's locked; a
 *  confirmed-but-unlocked match is offered to lock; a journal's match on
 *  every course it's assigned to in the program becomes its own toRemove/
 *  confirmed/lockedSkipped entry, so bulk-applying the whole result locks
 *  or removes all of them together (same effect as toggleJournalLock). */
export async function buildProgramValidationPreview(
  db: ReturnType<typeof serviceClient>,
  programId: number,
  courseRows: ValidationRow[],
  journalRows: ValidationRow[],
): Promise<ProgramMatchPreview> {
  type SubjectRow = { id: number; course_code: string | null; course_title: string; program_id: number };
  const subjects = await pageThrough<SubjectRow>((from, to) =>
    db.from("subjects")
      .select("id, course_code, course_title, program_id").eq("program_id", programId)
      .range(from, to) as unknown as PromiseLike<{ data: SubjectRow[] | null; error: { message: string } | null }>,
  );

  const subjectByCode = new Map(subjects
    .filter((s) => (s.course_code ?? "").trim())
    .map((s) => [s.course_code!.trim().toLowerCase(), s]));

  const rowsBySubject = new Map<number, ValidationRow[]>();
  const unknownCourses = new Set<string>();
  for (const r of courseRows) {
    const subj = subjectByCode.get(r.course_code.trim().toLowerCase());
    if (!subj) { unknownCourses.add(r.course_code); continue; }
    if (!rowsBySubject.has(subj.id)) rowsBySubject.set(subj.id, []);
    rowsBySubject.get(subj.id)!.push(r);
  }

  const preview: ProgramMatchPreview = {
    toRemove: [], lockedSkipped: [], confirmed: [], unresolvedRows: [],
    unknownCourses: Array.from(unknownCourses),
  };

  const subjectIds = Array.from(rowsBySubject.keys());
  type Joined = { subject_id: number; title_id: number; manual: number; titles: { id: number; title: string; isbn: string } };
  const assignments: Joined[] = [];
  for (let i = 0; i < subjectIds.length; i += SUBJECT_CHUNK) {
    const chunk = subjectIds.slice(i, i + SUBJECT_CHUNK);
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

      const entry: MatchPreviewRow = {
        subject_id: subjectId, course_code: subj.course_code ?? "", course_title: subj.course_title,
        title_id: a.title_id, title: a.titles.title,
      };

      const notApplicable = match ? match.verdict === false : true;
      if (!notApplicable) {
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
    // Every subject in the program, not just the ones mentioned in course
    // rows above -- a journal can be attached to any of them.
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
      const matchIdx = journalRows.findIndex((r) =>
        standardTitleMatches({ title: r.title, isbn: r.isbn }, { title: a.titles.title, isbn: a.titles.issn ?? "" }));
      const match = matchIdx >= 0 ? journalRows[matchIdx] : undefined;
      if (match) matchedJournalRowIdx.add(matchIdx);

      const entry: MatchPreviewRow = {
        subject_id: a.subject_id, course_code: "", course_title: "(Program-wide)",
        title_id: a.title_id, title: a.titles.title,
      };

      const notApplicable = match ? match.verdict === false : true;
      if (!notApplicable) {
        if (!a.manual) preview.confirmed.push(entry);
        continue;
      }

      if (a.manual) preview.lockedSkipped.push(entry);
      else preview.toRemove.push(entry);
    }

    journalRows.forEach((r, i) => {
      if (!matchedJournalRowIdx.has(i)) preview.unresolvedRows.push({ course_code: "(Program-wide)", title: r.title });
    });
  }

  return preview;
}
