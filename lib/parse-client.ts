function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return Number(v).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  }
  return String(v).trim();
}

const SPREADSHEET_EXTS = new Set(["xls", "xlsx", "csv"]);
const SPREADSHEET_MIME = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);

export function isSpreadsheet(file: File): boolean {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return SPREADSHEET_EXTS.has(ext) || SPREADSHEET_MIME.has(file.type);
}

/** Parse a spreadsheet file in the browser using a dynamic xlsx import. */
export async function parseSheetRows(file: File): Promise<Record<string, string>[]> {
  // Dynamic import so Next.js doesn't try to resolve xlsx during SSR.
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();

  let wb: import("xlsx").WorkBook;
  if (ext === "csv" || file.type === "text/csv" || file.type === "application/csv") {
    wb = XLSX.read(new TextDecoder().decode(buf), { type: "string" });
  } else {
    wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  }

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cellToString(v)])),
  );
}

// ---------------------------------------------------------------------------
// Validation rows: client-safe counterpart to lib/parsers.ts's
// buildValidationRowsFromRaw (small, dependency-free duplicate of norm/
// buildHeaderMap here rather than importing lib/parsers.ts, which pulls in
// a static `xlsx` import not worth adding to this file's client bundle).
// ---------------------------------------------------------------------------
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

const VALIDATE_ALIASES: Record<string, string[]> = {
  course_code: ["course code", "code", "course_code", "subject code"],
  program: ["program", "programme", "program name"],
  title: ["title"],
  isbn: ["isbn", "isbn-13", "isbn13", "issn"],
  verdict: [
    "applicable", "applicable to course", "applicable?",
    "valid", "keep", "keep?", "match", "matched", "ai match", "ai verdict",
    "verdict", "decision", "status", "correct", "relevant", "result",
  ],
};

const VERDICT_YES = new Set(["yes", "y", "true", "1", "keep", "valid", "correct", "applicable", "match", "matched", "relevant", "ok", "pass"]);
const VERDICT_NO = new Set(["no", "n", "false", "0", "remove", "invalid", "incorrect", "not applicable", "no match", "not matched", "irrelevant", "drop", "delete", "fail"]);

export type ValidationRow = {
  course_code: string;
  program: string;
  title: string;
  isbn: string;
  verdict: boolean | null;
};

/** Narrows browser-parsed raw rows (see parseSheetRows above) down to just
 *  the fields Validate Matches CSV needs -- course_code/program/title/
 *  isbn/verdict -- dropping every other export column (Section,
 *  Description, Resource Type, Author, Publisher, Year, Copies, Link).
 *  Doing this client-side, before the rows are sent anywhere, is what
 *  keeps a large multi-program export's request body small; see
 *  lib/parsers.ts's parseValidationRows for the server-side counterpart
 *  that starts from a raw file instead of already-parsed rows. */
export function buildValidationRowsFromRaw(rows: Record<string, string>[]): ValidationRow[] {
  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), VALIDATE_ALIASES);
  if (!map.course_code || !map.title) {
    throw new Error(`Could not find Course Code and Title columns. Headers: ${Object.keys(rows[0]).join(", ")}`);
  }
  const out: ValidationRow[] = [];
  for (const r of rows) {
    const course_code = (r[map.course_code] || "").trim();
    const program = map.program ? (r[map.program] || "").trim() : "";
    const title = (r[map.title] || "").trim();
    if (!title || (!course_code && !program)) continue;
    let verdict: boolean | null = null;
    if (map.verdict) {
      const raw = norm(r[map.verdict]);
      if (VERDICT_YES.has(raw)) verdict = true;
      else if (VERDICT_NO.has(raw)) verdict = false;
    }
    out.push({
      course_code, program, title,
      isbn: map.isbn ? (r[map.isbn] || "").trim() : "",
      verdict,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canvassing mass-validate rows: the download/upload round-trip in
// CanvassingTab exports every canvassing row's own numeric id and its
// currently proposed subject id, so the upload side matches by id instead
// of fuzzy title/course-code text -- simpler and unambiguous, unlike
// buildValidationRowsFromRaw above (which has no stable id to key off of).
// ---------------------------------------------------------------------------
const CANVASSING_VALIDATE_ALIASES: Record<string, string[]> = {
  id: ["id", "canvassing id", "row id"],
  subject_id: ["proposed subject id", "proposed course id", "subject id", "course id"],
  validate: ["validate? (y/n)", "validate?", "validate", "approve?", "approve", "confirm?", "confirm"],
};

export type CanvassingValidateRow = { id: number; subject_id: number | null; validate: boolean | null };

/** Narrows browser-parsed raw rows (see parseSheetRows above) down to what
 *  /api/canvassing/mass-validate needs. A row is only actionable once
 *  filtered by the caller to validate === true && subject_id != null --
 *  left as separate fields here (rather than dropping unusable rows) so
 *  the caller can report back how many rows were skipped and why. */
export function buildCanvassingValidateRowsFromRaw(rows: Record<string, string>[]): CanvassingValidateRow[] {
  if (rows.length === 0) return [];
  const map = buildHeaderMap(Object.keys(rows[0]), CANVASSING_VALIDATE_ALIASES);
  if (!map.id) {
    throw new Error(`Could not find an ID column. Headers: ${Object.keys(rows[0]).join(", ")}`);
  }
  const out: CanvassingValidateRow[] = [];
  for (const r of rows) {
    const id = parseInt(r[map.id] || "", 10);
    if (!Number.isFinite(id)) continue;
    const subjectIdRaw = map.subject_id ? parseInt(r[map.subject_id] || "", 10) : NaN;
    const subject_id = Number.isFinite(subjectIdRaw) && subjectIdRaw > 0 ? subjectIdRaw : null;
    let validate: boolean | null = null;
    if (map.validate) {
      const raw = norm(r[map.validate]);
      if (VERDICT_YES.has(raw)) validate = true;
      else if (VERDICT_NO.has(raw)) validate = false;
    }
    out.push({ id, subject_id, validate });
  }
  return out;
}
