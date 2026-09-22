import type { ResourceTypeId } from "./resources";

export type TitleFormat = ResourceTypeId;

export type TitleRow = {
  id?: number;
  format?: TitleFormat;
  title: string;
  author?: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  issn?: string;
  call_no?: string;
  copies?: number;
  url?: string;
  subjects?: string;
  campus?: string;
  /** Per-copy accession/barcode number, if the source file has one — used to
   *  avoid double-counting the same physical copy across repeat uploads. */
  barcode?: string;
  /** Where a digital title actually comes from -- a subscription platform/
   *  vendor for paid eBooks/journals (e.g. "Perlego"), or the donor/partner
   *  institution for complementary ones (donated, or provided free under a
   *  MOA/MOU). Meaningful for ebook_paid, ebook_complementary,
   *  journal_online_paid, and journal_complementary -- lets every title
   *  from one source be found and removed together if that subscription
   *  ends or that agreement lapses. */
  provider?: string;
  /** Set on titles returned from a program bibliography: whether the
   *  match to that course is protected (assignments.manual=1) -- Match
   *  runs never delete a protected assignment, so it survives even
   *  though the course itself keeps getting re-matched. */
  manual?: number;
  /** Set on a journal returned from a program bibliography: the name of
   *  the program(s) it's assigned to (" + "-joined when a combined-programs
   *  report merges the same journal in from more than one source program).
   *  A journal has no course of its own to say this the way a book's
   *  Course Code/Title does, so exports need it spelled out explicitly --
   *  see loadProgramBibliography/loadCombinedProgramBibliography in
   *  lib/bibliography.ts and programBibliographyCsv in lib/exports.ts. */
  program?: string;
};

export type ProgramRow = {
  id?: number;
  name: string;
};

export type SubjectRow = {
  id?: number;
  program_id?: number;
  course_code?: string;
  course_title: string;
  description?: string;
  sort_order?: number;
  /** Admin override for what matching searches for on this course,
   *  instead of deriving it from course_title/description -- see
   *  supabase/migrations/50_subject_match_keyword.sql. Empty/unset means
   *  "use the normal title/description-based matching." */
  match_keyword?: string;
  /** @deprecated No longer read by /api/match/run -- locking is now
   *  per-title (assignments.manual), so a course stays open to newly
   *  matched titles while individually protected ones survive. Column
   *  kept for old data; not surfaced in the UI anymore. */
  locked?: boolean;
};

export type AssignmentRow = {
  id?: number;
  subject_id: number;
  title_id: number;
  score?: number;
  rank?: number;
  explanation?: string;
  manual?: number;
};

export type CitationStyle = "apa7" | "mla9" | "chicago" | "harvard";
