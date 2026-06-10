/**
 * File parsers for Perlego title lists and course descriptions.
 * Supports: .xlsx, .xls, .csv, .pdf, .docx
 */
import * as XLSX from "xlsx";
import type { TitleRow, CourseRow } from "./types";

const TITLE_ALIASES: Record<keyof TitleRow, string[]> = {
  title: ["title", "book title", "publication_title", "publication title", "name"],
  author: ["author", "authors", "first_author", "author(s)", "first author"],
  publisher: ["publisher", "publisher_name", "publisher name"],
  year: ["year", "publication_year", "publication year", "pub year", "date"],
  isbn: ["isbn", "online_identifier", "online identifier", "isbn-13", "isbn13", "eisbn"],
  edition: ["edition", "ed."],
  url: ["url", "title_url", "link"],
  subjects: ["subjects", "subject", "tags", "keywords"],
  id: [],
};

const COURSE_ALIASES: Record<keyof CourseRow, string[]> = {
  campus: ["campus"],
  college: ["college", "school", "faculty"],
  program: ["program", "programme", "program / degree", "degree"],
  major: ["major", "track", "specialization", "major/ track / specialization", "major / track / specialization"],
  course_code: ["course code", "code", "course_code"],
  course_title: ["course title", "course", "title", "subject title"],
  description: ["description", "course description", "syllabus"],
  learning_outcomes: ["learning outcomes", "outcomes", "objectives", "course outcomes"],
  keywords: ["keywords", "tags", "topics"],
  enrollment: ["enrollment", "students", "enrolment", "no. of students"],
  id: [],
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function buildHeaderMap<T extends Record<string, string[]>>(columns: string[], aliases: T): Partial<Record<keyof T, string>> {
  const normed = new Map(columns.map((c) => [norm(c), c]));
  const out: Partial<Record<keyof T, string>> = {};
  for (const key of Object.keys(aliases) as Array<keyof T>) {
    for (const alt of aliases[key]) {
      const actual = normed.get(alt);
      if (actual) { out[key] = actual; break; }
    }
  }
  return out;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // Preserve full precision for ISBN-like integers; avoid scientific notation.
    if (Number.isInteger(v)) return v.toString();
    return Number(v).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  }
  return String(v).trim();
}

function rowsFromWorkbook(wb: XLSX.WorkBook): Record<string, string>[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k] = cellToString(v);
    return out;
  });
}

function rowsFromSheet(buf: Buffer): Record<string, string>[] {
  return rowsFromWorkbook(XLSX.read(buf, { type: "buffer" }));
}

function rowsFromCsv(buf: Buffer): Record<string, string>[] {
  return rowsFromWorkbook(XLSX.read(buf.toString("utf-8"), { type: "string" }));
}

async function pdfText(buf: Buffer): Promise<string> {
  // pdf-parse is CJS; dynamic import keeps it out of edge bundles.
  const mod = await import("pdf-parse");
  const pdf = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  const out = await pdf(buf);
  return out.text || "";
}

async function docxText(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer: buf });
  return res.value || "";
}

export async function parseTitles(filename: string, buf: Buffer): Promise<TitleRow[]> {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  let rows: Record<string, string>[];
  if (ext === "csv") rows = rowsFromCsv(buf);
  else if (ext === "xlsx" || ext === "xls") rows = rowsFromSheet(buf);
  else if (ext === "pdf" || ext === "docx") {
    const text = ext === "pdf" ? await pdfText(buf) : await docxText(buf);
    return freeformTitles(text);
  } else throw new Error(`Unsupported titles format: .${ext}`);

  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), TITLE_ALIASES);
  if (!map.title) {
    throw new Error(
      `Could not find a title column. Headers seen: ${Object.keys(rows[0]).join(", ")}`,
    );
  }
  const out: TitleRow[] = [];
  for (const r of rows) {
    const t: TitleRow = { title: (r[map.title] || "").trim() };
    if (!t.title) continue;
    if (map.author) t.author = (r[map.author] || "").trim();
    if (map.publisher) t.publisher = (r[map.publisher] || "").trim();
    if (map.year) t.year = (r[map.year] || "").trim();
    if (map.isbn) t.isbn = (r[map.isbn] || "").trim();
    if (map.edition) t.edition = (r[map.edition] || "").trim();
    if (map.url) t.url = (r[map.url] || "").trim();
    if (map.subjects) t.subjects = (r[map.subjects] || "").trim();
    out.push(t);
  }
  return out;
}

function freeformTitles(text: string): TitleRow[] {
  const out: TitleRow[] = [];
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (line.length < 8) continue;
    const m = /^(?<author>[^.]+)\.\s*\((?<year>\d{4})\)\.\s*(?<title>[^.]+)\.\s*(?<publisher>[^.]+)\.?$/.exec(line);
    if (m?.groups) {
      out.push({
        author: m.groups.author.trim(),
        year: m.groups.year,
        title: m.groups.title.trim(),
        publisher: m.groups.publisher.trim(),
      });
    } else if (line.includes(" - ")) {
      const parts = line.split(" - ").map((s) => s.trim());
      if (parts.length >= 2) out.push({ title: parts[0], author: parts[1] });
    }
  }
  return out;
}

export async function parseCourses(filename: string, buf: Buffer): Promise<CourseRow[]> {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  let rows: Record<string, string>[];
  if (ext === "csv") rows = rowsFromCsv(buf);
  else if (ext === "xlsx" || ext === "xls") rows = rowsFromSheet(buf);
  else if (ext === "pdf" || ext === "docx") {
    const text = ext === "pdf" ? await pdfText(buf) : await docxText(buf);
    return text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .map<CourseRow>((b) => ({
        course_title: (b.split("\n")[0] || "Untitled").slice(0, 300),
        description: b,
      }));
  } else throw new Error(`Unsupported courses format: .${ext}`);

  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), COURSE_ALIASES);
  const out: CourseRow[] = [];
  for (const r of rows) {
    const c: CourseRow = {
      course_title:
        (map.course_title && r[map.course_title]) ||
        (map.program && r[map.program]) ||
        "Untitled Course",
    };
    if (map.campus) c.campus = (r[map.campus] || "").trim();
    if (map.college) c.college = (r[map.college] || "").trim();
    if (map.program) c.program = (r[map.program] || "").trim();
    if (map.major) c.major = (r[map.major] || "").trim();
    if (map.course_code) c.course_code = (r[map.course_code] || "").trim();
    if (map.description) c.description = (r[map.description] || "").trim();
    if (map.learning_outcomes) c.learning_outcomes = (r[map.learning_outcomes] || "").trim();
    if (map.keywords) c.keywords = (r[map.keywords] || "").trim();
    if (map.enrollment) {
      const n = parseInt(r[map.enrollment] || "0", 10);
      c.enrollment = Number.isFinite(n) ? n : 0;
    }
    const substantive = c.course_title || c.program || c.course_code || c.description;
    if (substantive) out.push(c);
  }
  return out;
}
