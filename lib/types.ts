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
  /** When true, /api/match/run skips this subject entirely so a curated
   *  title list is never touched by a future match run. */
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
