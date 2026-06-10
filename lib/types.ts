export type TitleRow = {
  id?: number;
  title: string;
  author?: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  edition?: string;
  url?: string;
  subjects?: string;
};

export type CourseRow = {
  id?: number;
  campus?: string;
  college?: string;
  program?: string;
  major?: string;
  course_code?: string;
  course_title: string;
  description?: string;
  learning_outcomes?: string;
  keywords?: string;
  enrollment?: number;
};

export type MatchRow = {
  course_id: number;
  title_id: number;
  score: number;
  rank: number;
  explanation?: string;
  overridden?: number;
};

export type RecommendationRow = {
  Campus: string;
  College: string;
  Program: string;
  Course: string;
  "Book Title": string;
  Author: string;
  "Publication Year": string;
  Publisher: string;
  "Number of Copies": number;
};

export type CitationStyle = "apa7" | "mla9" | "chicago" | "harvard";
