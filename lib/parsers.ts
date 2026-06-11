/**
 * File parsers.
 *
 * - parseEbookTitles:  Perlego-style title lists (xlsx/xls/csv/pdf/docx)
 * - parsePrintedBooks: library catalog rows with Call No., Author, Title, Year, Copies
 * - parseSubjects:     per-program subject list (course code, title, description, optional section)
 */
import * as XLSX from "xlsx";
import type { TitleRow, SubjectRow } from "./types";
import type { ResourceType } from "./resources";

const EBOOK_ALIASES: Record<string, string[]> = {
  title: ["title", "book title", "publication_title", "publication title", "name"],
  author: ["author", "authors", "first_author", "author(s)", "first author"],
  publisher: ["publisher", "publisher_name", "publisher name"],
  year: ["year", "publication_year", "publication year", "pub year", "date"],
  isbn: ["isbn", "online_identifier", "online identifier", "isbn-13", "isbn13", "eisbn"],
  url: ["url", "title_url", "link"],
  subjects: ["subjects", "subject", "tags", "keywords"],
};

const PRINTED_ALIASES: Record<string, string[]> = {
  call_no: ["call no", "call no.", "call number", "callno", "call_no", "classification"],
  author: ["author", "authors", "first_author"],
  title: ["title", "book title"],
  year: ["year", "publication_year", "publication year", "copyright"],
  copies: ["copy", "copies", "no. of copies", "volumes"],
  publisher: ["publisher", "publisher_name"],
  isbn: ["isbn", "isbn-13", "isbn13"],
  campus: ["campus", "branch", "library"],
};

const SUBJECT_ALIASES: Record<string, string[]> = {
  program: ["program", "programme", "program / degree", "degree"],
  course_code: ["course code", "code", "course_code", "subject code"],
  course_title: ["course title", "course", "title", "subject title", "subject"],
  description: ["description", "course description", "syllabus", "synopsis"],
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function buildHeaderMap(columns: string[], aliases: Record<string, string[]>): Record<string, string> {
  const normed = new Map(columns.map((c) => [norm(c), c]));
  const out: Record<string, string> = {};
  for (const [canonical, alts] of Object.entries(aliases)) {
    for (const alt of alts) {
      const actual = normed.get(alt);
      if (actual) { out[canonical] = actual; break; }
    }
  }
  return out;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return Number(v).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  }
  return String(v).trim();
}

function rowsFromWorkbook(wb: XLSX.WorkBook, sheetName?: string): Record<string, string>[] {
  const sheet = wb.Sheets[sheetName || wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k] = cellToString(v);
    return out;
  });
}

function readSheet(filename: string, buf: Buffer): XLSX.WorkBook {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "csv") return XLSX.read(buf.toString("utf-8"), { type: "string" });
  if (ext === "xlsx" || ext === "xls") return XLSX.read(buf, { type: "buffer" });
  throw new Error(`Expected xlsx/xls/csv, got .${ext}`);
}

async function pdfText(buf: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const pdf = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
  return (await pdf(buf)).text || "";
}

async function docxText(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  return (await mammoth.extractRawText({ buffer: buf })).value || "";
}

// ---------------------------------------------------------------------------
// eBook (Perlego) titles
// ---------------------------------------------------------------------------
export async function parseEbookTitles(filename: string, buf: Buffer): Promise<TitleRow[]> {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || ext === "docx") {
    const text = ext === "pdf" ? await pdfText(buf) : await docxText(buf);
    // freeform parser: format is assigned by the upload route based on URL slug
    return freeformTitles(text).map((t) => ({ ...t, copies: 1 }));
  }
  const rows = rowsFromWorkbook(readSheet(filename, buf));
  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), EBOOK_ALIASES);
  if (!map.title) {
    throw new Error(`Could not find a title column. Headers: ${Object.keys(rows[0]).join(", ")}`);
  }
  const out: TitleRow[] = [];
  for (const r of rows) {
    const title = (r[map.title] || "").trim();
    if (!title) continue;
    out.push({
      title,
      author: map.author ? r[map.author] : "",
      publisher: map.publisher ? r[map.publisher] : "",
      year: map.year ? r[map.year] : "",
      isbn: map.isbn ? r[map.isbn] : "",
      url: map.url ? r[map.url] : "",
      subjects: map.subjects ? r[map.subjects] : "",
      copies: 1,
    });
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

// ---------------------------------------------------------------------------
// Journals
// ---------------------------------------------------------------------------
const JOURNAL_ALIASES: Record<string, string[]> = {
  title: ["title", "journal title", "publication_title", "publication title", "journal", "name"],
  author: ["author", "editor", "first_author"],
  publisher: ["publisher", "publisher_name", "publisher name"],
  year: ["year", "publication_year", "publication year", "vol year"],
  issn: ["issn", "issn-l", "eissn", "online_identifier", "online identifier"],
  call_no: ["call no", "call no.", "call number", "callno", "classification"],
  copies: ["copy", "copies", "subscriptions", "no. of copies", "volumes"],
  url: ["url", "title_url", "link", "homepage"],
  campus: ["campus", "branch", "library"],
};

export async function parseJournals(filename: string, buf: Buffer): Promise<TitleRow[]> {
  const rows = rowsFromWorkbook(readSheet(filename, buf));
  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), JOURNAL_ALIASES);
  if (!map.title) {
    throw new Error(`Could not find a title column. Headers: ${Object.keys(rows[0]).join(", ")}`);
  }
  const out: TitleRow[] = [];
  for (const r of rows) {
    const title = (r[map.title] || "").trim();
    if (!title) continue;
    let copies = 1;
    if (map.copies) {
      const n = parseInt(r[map.copies] || "0", 10);
      if (Number.isFinite(n) && n > 0) copies = n;
    }
    out.push({
      title,
      author: map.author ? r[map.author] : "",
      publisher: map.publisher ? r[map.publisher] : "",
      year: map.year ? r[map.year] : "",
      issn: map.issn ? r[map.issn] : "",
      call_no: map.call_no ? r[map.call_no] : "",
      url: map.url ? r[map.url] : "",
      copies,
      // campus is optional; if absent the upload route fills it from the UI dropdown.
      campus: map.campus ? (r[map.campus] || "").trim() : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Printed books (library catalog rows)
// ---------------------------------------------------------------------------
export async function parsePrintedBooks(filename: string, buf: Buffer): Promise<TitleRow[]> {
  const rows = rowsFromWorkbook(readSheet(filename, buf));
  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), PRINTED_ALIASES);
  if (!map.title) {
    throw new Error(`Could not find a title column. Headers: ${Object.keys(rows[0]).join(", ")}`);
  }
  const out: TitleRow[] = [];
  for (const r of rows) {
    const title = (r[map.title] || "").trim();
    if (!title) continue;
    let copies = 1;
    if (map.copies) {
      const n = parseInt(r[map.copies] || "0", 10);
      if (Number.isFinite(n) && n > 0) copies = n;
    }
    out.push({
      title,
      call_no: map.call_no ? r[map.call_no] : "",
      author: map.author ? r[map.author] : "",
      year: map.year ? r[map.year] : "",
      publisher: map.publisher ? r[map.publisher] : "",
      isbn: map.isbn ? r[map.isbn] : "",
      copies,
      campus: map.campus ? (r[map.campus] || "").trim() : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build TitleRows from raw rows already parsed by the browser
// ---------------------------------------------------------------------------
export function buildTitleRowsFromRaw(
  filename: string,
  rows: Record<string, string>[],
  rt: ResourceType,
): TitleRow[] {
  if (rows.length === 0) return [];
  const aliases = rt.kind === "journal" ? JOURNAL_ALIASES
    : rt.medium === "print" ? PRINTED_ALIASES
    : EBOOK_ALIASES;
  const map = buildHeaderMap(Object.keys(rows[0]), aliases);
  if (!map.title) {
    throw new Error(`Could not find a title column. Headers: ${Object.keys(rows[0]).join(", ")}`);
  }
  const out: TitleRow[] = [];
  for (const r of rows) {
    const title = (r[map.title] ?? "").trim();
    if (!title) continue;
    let copies = 1;
    if (map.copies) {
      const n = parseInt(r[map.copies] ?? "0", 10);
      if (Number.isFinite(n) && n > 0) copies = n;
    }
    out.push({
      title,
      author: map.author ? r[map.author] : "",
      publisher: map.publisher ? r[map.publisher] : "",
      year: map.year ? r[map.year] : "",
      isbn: map.isbn ? r[map.isbn] : "",
      issn: map.issn ? r[map.issn] : "",
      call_no: map.call_no ? r[map.call_no] : "",
      url: map.url ? r[map.url] : "",
      subjects: map.subjects ? r[map.subjects] : "",
      copies,
      campus: map.campus ? (r[map.campus] ?? "").trim() : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Subjects (per-program course list)
// ---------------------------------------------------------------------------
export type ParsedSubject = SubjectRow & { program?: string };

export async function parseSubjects(filename: string, buf: Buffer): Promise<ParsedSubject[]> {
  const rows = rowsFromWorkbook(readSheet(filename, buf));
  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), SUBJECT_ALIASES);
  if (!map.course_title && !map.course_code) {
    throw new Error(`Could not find a course title or code column. Headers: ${Object.keys(rows[0]).join(", ")}`);
  }
  const out: ParsedSubject[] = [];
  let order = 0;
  for (const r of rows) {
    const courseTitle = (map.course_title ? r[map.course_title] : "").trim();
    const courseCode = (map.course_code ? r[map.course_code] : "").trim();
    if (!courseTitle && !courseCode) continue;
    out.push({
      program: map.program ? r[map.program] : "",
      course_code: courseCode,
      course_title: courseTitle || courseCode,
      description: map.description ? r[map.description] : "",
      sort_order: order++,
    });
  }
  return out;
}
