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
