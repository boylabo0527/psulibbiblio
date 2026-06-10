import { formatCitation } from "./citations";
import { recommendCopies } from "./matcher";
import { serviceClient } from "./supabase";
import type { CitationStyle, RecommendationRow } from "./types";

export type RecFilters = {
  campus?: string;
  college?: string;
  program?: string;
  course?: string;
  author?: string;
  publisher?: string;
  year?: string;
  style?: CitationStyle;
};

type Joined = {
  course_id: number;
  title_id: number;
  courses: {
    campus: string; college: string; program: string;
    course_title: string; enrollment: number;
  };
  titles: {
    title: string; author: string; publisher: string; year: string;
  };
};

const PAGE = 1000;

export async function loadRecommendations(filters: RecFilters): Promise<{
  rows: RecommendationRow[];
  bibliography: Record<string, string[]>;
}> {
  const db = serviceClient();
  const style: CitationStyle = (filters.style as CitationStyle) || "apa7";

  let q = db
    .from("matches")
    .select(`
      course_id, title_id,
      courses!inner ( campus, college, program, course_title, enrollment ),
      titles!inner  ( title, author, publisher, year )
    `);
  if (filters.campus)   q = q.eq("courses.campus", filters.campus);
  if (filters.college)  q = q.eq("courses.college", filters.college);
  if (filters.program)  q = q.eq("courses.program", filters.program);
  if (filters.course)   q = q.ilike("courses.course_title", `%${filters.course}%`);
  if (filters.author)   q = q.ilike("titles.author", `%${filters.author}%`);
  if (filters.publisher) q = q.ilike("titles.publisher", `%${filters.publisher}%`);
  if (filters.year)     q = q.eq("titles.year", filters.year);

  const all: Joined[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as Joined[]));
    if (data.length < PAGE) break;
  }

  const titleCourses = new Map<number, Set<number>>();
  const titleEnroll = new Map<number, number>();
  for (const m of all) {
    const set = titleCourses.get(m.title_id) ?? new Set<number>();
    set.add(m.course_id);
    titleCourses.set(m.title_id, set);
    titleEnroll.set(m.title_id, (titleEnroll.get(m.title_id) ?? 0) + (m.courses.enrollment || 0));
  }

  const rows: RecommendationRow[] = [];
  const bibliography: Record<string, string[]> = {};

  for (const m of all) {
    const copies = recommendCopies(
      titleCourses.get(m.title_id)?.size ?? 1,
      titleEnroll.get(m.title_id) ?? 0,
    );
    rows.push({
      Campus: m.courses.campus || "",
      College: m.courses.college || "",
      Program: m.courses.program || "",
      Course: m.courses.course_title || "",
      "Book Title": m.titles.title || "",
      Author: m.titles.author || "",
      "Publication Year": m.titles.year || "",
      Publisher: m.titles.publisher || "",
      "Number of Copies": copies,
    });
    const cite = formatCitation(
      { title: m.titles.title, author: m.titles.author, year: m.titles.year, publisher: m.titles.publisher },
      style,
    );
    const key = `${m.courses.campus} | ${m.courses.college} | ${m.courses.program} | ${m.courses.course_title}`;
    (bibliography[key] ||= []).push(cite);
  }

  rows.sort((a, b) => {
    for (const k of ["Campus", "College", "Program", "Course", "Book Title"] as const) {
      const cmp = String(a[k]).localeCompare(String(b[k]));
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  return { rows, bibliography };
}
