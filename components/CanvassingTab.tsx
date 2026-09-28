"use client";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import { parseSheetRows, isSpreadsheet, buildCanvassingValidateRowsFromRaw, type CanvassingValidateRow } from "@/lib/parse-client";
import { groupRows } from "@/lib/group-rows";
import { isPriceStale, daysSincePriced, PRICE_VALIDITY_DAYS } from "@/lib/pricing";
import SearchableSelect from "@/components/SearchableSelect";
import type { CanvassingRow } from "@/app/api/canvassing/route";
import type { ProcurementRow } from "@/app/api/procurement/route";
import type { SupplierOfferRow } from "@/app/api/supplier/offers/route";

function yearOf(iso: string): string {
  return iso ? String(new Date(iso).getFullYear()) : "";
}

function money(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2 });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// Prioritizes the course title over the course code -- the code (e.g. "PSM
// 1") is a short administrative label that never appears in a real book
// title, so weighting it equally with the title (the old behavior) let
// coincidental single-word overlaps outrank genuinely relevant titles,
// producing far-fetched suggestions. This instead:
//  1. Tiers an exact phrase match (either title contains the other) far
//     above everything else -- the strongest, least ambiguous signal.
//  2. Otherwise scores by what FRACTION of the course title's own
//     significant words are present in the canvassed title (not a raw
//     count), so a short precise course title matching well beats a long
//     course title matching only a couple of incidental words.
//  3. Excludes generic course-naming words ("introduction", "fundamentals",
//     etc.) that show up in many unrelated course titles and would
//     otherwise inflate matches across the board.
//  4. The course code only tips a near-tie, as a minor bonus, never the
//     primary signal.
const NOISE_WORDS = new Set([
  "the","and","of","in","to","a","an","for","on","with","by","at","as","is","are","be","or",
  "it","its","from","that","this","into","has","have","not","but","was","were","can","all",
  "more","their","they","been","also","over","some","such","than","then","these","those",
  "when","will","your","our","per","introduction","fundamentals","principles","concepts",
  "essentials","basic","basics","advanced","study","studies","practice","practices","general",
  "theory","theories","overview","survey","topics","course","special","selected",
]);

function significantWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !NOISE_WORDS.has(w));
}

function relevanceScore(canvTitle: string, subject: ProcurementRow): number {
  const canvLower = canvTitle.toLowerCase().trim();
  const courseLower = subject.course_title.toLowerCase().trim();
  if (!canvLower || !courseLower) return 0;

  if (canvLower.includes(courseLower) || courseLower.includes(canvLower)) {
    return 1000; // exact-phrase tier -- always wins over any partial-word match
  }

  const courseWords = significantWords(subject.course_title);
  if (courseWords.length === 0) return 0;
  const canvWords = new Set(significantWords(canvTitle));
  const hits = courseWords.filter((w) => canvWords.has(w)).length;
  const ratio = hits / courseWords.length;

  const codeBonus = subject.course_code && canvLower.includes(subject.course_code.toLowerCase()) ? 0.05 : 0;
  return ratio + codeBonus;
}

type UploadItemType = "book" | "journal";

async function downloadTemplate(fmt: "xlsx" | "csv", type: UploadItemType) {
  const XLSX = await import("xlsx");
  const headers = type === "journal"
    ? ["Subject Area", "Title", "Issue", "Year", "Supplier", "Manila Price", "Provincial Price", "Unit", "Quantity", "Stock No", "Notes"]
    : ["Title", "Author", "Publisher", "Year", "ISBN", "Supplier", "Price", "Unit", "Quantity", "Stock No", "Notes"];
  const example = type === "journal"
    ? ["Business Administration", "Harvard Business Review", "Vol. 102 No. 3", "2024", "National Book Store", "450.00", "520.00", "copy", "1", "", ""]
    : ["Introduction to Philosophy", "Popkin, Richard", "Cengage", "2020", "978-0-123456-78-9", "National Book Store", "850.00", "copy", "1", "", ""];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type === "journal" ? "Periodicals" : "Canvassing");
  const buf = XLSX.write(wb, { type: "buffer", bookType: fmt });
  const blob = new Blob([buf], { type: fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${type === "journal" ? "periodicals" : "canvassing"}_template.${fmt}`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

type ParsedRow = {
  title: string; author: string; publisher: string; year: string; isbn: string;
  supplier: string; unit: string; stock_prop_no: string;
  unit_cost: number; quantity: number; notes: string;
  item_type: UploadItemType; subject_area: string; issue: string;
  manila_price: number | null; provincial_price: number | null;
};

function mapRow(raw: Record<string, string>, type: UploadItemType): ParsedRow {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.entries(raw).find(([rk]) => rk.toLowerCase() === k.toLowerCase());
      if (found && found[1] !== "") return found[1];
    }
    return "";
  };
  const manilaPrice = parseFloat(get("manila price", "manila") || "");
  const provincialPrice = parseFloat(get("provincial price", "provincial") || "");
  return {
    title: get("title", "book title", "name"),
    author: get("author", "authors"),
    publisher: get("publisher"),
    year: get("year", "publication year"),
    isbn: get("isbn"),
    supplier: get("supplier", "vendor", "store"),
    unit: get("unit") || "copy",
    stock_prop_no: get("stock no", "prop no", "stock/prop no", "stock_prop_no"),
    // For a journal, unit_cost is a display-only fallback -- the bulk API
    // always recomputes it from provincial_price server-side (see
    // /api/canvassing/bulk), so this only matters for the preview table.
    unit_cost: type === "journal"
      ? (Number.isFinite(provincialPrice) ? provincialPrice : 0)
      : (parseFloat(get("price", "unit cost", "cost", "amount") || "0") || 0),
    quantity: parseInt(get("quantity", "qty") || "1") || 1,
    notes: get("notes", "remarks"),
    item_type: type,
    subject_area: type === "journal" ? get("subject area", "subject") : "",
    issue: type === "journal" ? get("issue", "volume") : "",
    manila_price: type === "journal" && Number.isFinite(manilaPrice) ? manilaPrice : null,
    provincial_price: type === "journal" && Number.isFinite(provincialPrice) ? provincialPrice : null,
  };
}

const MIGRATION_SQL = `-- If table already exists, just add missing column:
alter table canvassing add column if not exists canvass_date date;

-- Full create (only if table does not exist):
-- create table canvassing (
--   id bigint generated always as identity primary key,
--   title text not null, author text, publisher text, year text, isbn text,
--   subject_id bigint references subjects(id),
--   program_id bigint references programs(id),
--   supplier text, unit text default 'copy', stock_prop_no text,
--   unit_cost numeric(10,2) default 0, quantity integer default 1,
--   canvass_date date, notes text, created_at timestamptz default now()
-- );
-- alter table canvassing enable row level security;
-- create policy "service role full access" on canvassing using (true) with check (true);`;

export default function CanvassingTab() {
  const [rows, setRows] = useState<CanvassingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  // Upload
  const [canvassDate, setCanvassDate] = useState(todayStr());
  const [uploadType, setUploadType] = useState<UploadItemType>("book");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // Gap matching
  const [gaps, setGaps] = useState<ProcurementRow[]>([]);
  // Every subject, not just ones with a compliance gap -- gaps alone can't
  // resolve a validation upload's Course Code/Course Title text to a
  // subject_id when that subject happens to already be fully compliant.
  const [allSubjects, setAllSubjects] = useState<ProcurementRow[]>([]);
  const [loadingGaps, setLoadingGaps] = useState(false);
  // pending assignments: canvassing id → selected subject_id (string for select)
  const [assignments, setAssignments] = useState<Map<number, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [assignedGroupBy, setAssignedGroupBy] = useState<"none" | "program" | "supplier" | "year">("none");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [programFilter, setProgramFilter] = useState("");
  const [sortBy, setSortBy] = useState<"none" | "price_asc" | "price_desc" | "title_asc" | "date_desc" | "date_asc">("none");
  const [showOnlyUnsourced, setShowOnlyUnsourced] = useState(false);
  const [reverifyingId, setReverifyingId] = useState<number | null>(null);
  const [reverifyValue, setReverifyValue] = useState("");
  const [reverifyBusy, setReverifyBusy] = useState(false);
  const [recommendationsBySubject, setRecommendationsBySubject] = useState<Map<number, { title: string; author: string }[]>>(new Map());
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  // Mass validation (download proposed assignments, review offline, upload
  // to confirm+validate in one pass) -- see /api/canvassing/mass-validate.
  const [exportingValidation, setExportingValidation] = useState(false);
  const [validateUploadBusy, setValidateUploadBusy] = useState(false);
  const [validateUploadMsg, setValidateUploadMsg] = useState<string | null>(null);
  const [validateUploadErr, setValidateUploadErr] = useState<string | null>(null);

  // Bulk select on the "Matched & Ready for Purchase Request" table, for
  // Mass Validate / Mass Remove without leaving the app.
  const [selectedAssignedIds, setSelectedAssignedIds] = useState<Set<number>>(new Set());
  const [bulkActionBusy, setBulkActionBusy] = useState(false);

  function reload() {
    setLoading(true); setErr(null);
    apiFetch("/api/canvassing")
      .then(r => r.json())
      .then(j => {
        if (j.error) {
          const msg: string = j.error;
          // Only treat this as "table/column missing" if the message actually
          // says something doesn't exist AND names canvassing — a narrower
          // match than before, so unrelated errors (e.g. a foreign-key
          // violation from a stale program reference) show their real
          // message instead of a misleading "run this migration" prompt.
          const missingRelation = (msg.includes("does not exist") || msg.includes("schema cache")) && msg.toLowerCase().includes("canvassing");
          if (missingRelation) setNeedsMigration(true);
          else setErr(msg);
        } else setRows(j.rows ?? []);
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  function loadGaps() {
    if (gaps.length > 0) return;
    setLoadingGaps(true);
    apiFetch("/api/procurement") // no program filter = all programs
      .then(r => r.json())
      .then(j => {
        const all: ProcurementRow[] = j.rows ?? [];
        setAllSubjects(all);
        setGaps(all.filter(r => !r.compliant)); // only subjects with gaps
      })
      .catch(() => {})
      .finally(() => setLoadingGaps(false));
  }

  // Gaps are the full list of subjects still needing procurement --
  // loaded unconditionally on mount (previously this only ran once
  // canvassing rows existed, so a library with zero canvassing entries
  // uploaded yet never saw the gap list at all).
  useEffect(() => {
    reload();
    loadGaps();
    apiFetch("/api/title-recommendations")
      .then(r => r.json())
      .then(j => {
        const map = new Map<number, { title: string; author: string }[]>();
        for (const r of (j.rows ?? []) as { subject_id: number; title: string; author: string; status: string }[]) {
          if (r.status === "declined") continue;
          if (!map.has(r.subject_id)) map.set(r.subject_id, []);
          map.get(r.subject_id)!.push({ title: r.title, author: r.author });
        }
        setRecommendationsBySubject(map);
      })
      .catch(() => {}); // best-effort -- Faculty Recommendations may not be set up/granted yet
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate assignment dropdowns with best keyword match
  useEffect(() => {
    if (gaps.length === 0 || rows.length === 0) return;
    const init = new Map<number, string>();
    for (const r of rows) {
      if (r.subject_id) {
        init.set(r.id, String(r.subject_id)); // already assigned
      } else {
        // Find best matching subject -- only pre-select one if it actually
        // shares real relevance (score > 0). Previously this always
        // defaulted to gaps[0] even with zero overlap, which looked like a
        // confident suggestion but was really just "whatever gap happened
        // to be first" -- worse than leaving it for the librarian to pick.
        let best: ProcurementRow | null = null;
        let bestScore = 0;
        for (const g of gaps) {
          const s = relevanceScore(r.title, g);
          if (s > bestScore) { bestScore = s; best = g; }
        }
        init.set(r.id, best ? String(best.subject_id) : "");
      }
    }
    setAssignments(init);
  }, [gaps.length, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(file: File) {
    if (!isSpreadsheet(file)) { setUploadErr("Please upload an Excel (.xlsx/.xls) or CSV file."); return; }
    setParsing(true); setUploadErr(null); setParsed([]);
    try {
      const rawRows = await parseSheetRows(file);
      const mapped = rawRows.map(r => mapRow(r, uploadType)).filter(r => r.title.trim() !== "");
      if (mapped.length === 0) { setUploadErr("No valid rows found. Ensure the file has a Title column."); return; }
      setParsed(mapped);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally { setParsing(false); }
  }

  async function importParsed() {
    if (parsed.length === 0) return;
    setUploading(true); setUploadErr(null);
    try {
      const res = await apiFetch("/api/canvassing/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed, canvass_date: canvassDate || null }),
      });
      const j = await res.json();
      if (j.error) { setUploadErr(j.error); return; }
      setParsed([]); reload();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally { setUploading(false); }
  }

  async function saveAssignments() {
    setSaving(true);
    try {
      const unassigned = rows.filter(r => !r.subject_id);
      await Promise.all(unassigned.map(async r => {
        const subjectId = assignments.get(r.id);
        if (!subjectId) return;
        const gap = gaps.find(g => String(g.subject_id) === subjectId);
        if (!gap) return;
        await apiFetch("/api/canvassing/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.id, subject_id: gap.subject_id, program_id: gap.program_id }),
        });
      }));
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  async function unassign(id: number) {
    await apiFetch("/api/canvassing/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, subject_id: null, program_id: null }),
    });
    reload();
  }

  /** Downloads every canvassing row (assigned or not) with whichever course
   *  is currently proposed for it -- already assigned server-side, or just
   *  the on-screen best-guess suggestion for a still-unassigned row (same
   *  value the "Assign to Subject Gap" dropdown shows). A reviewer marks
   *  "Validate? (Y/N)" for each row they approve and uploads the file back
   *  via importValidationFile -- that single pass both confirms the
   *  assignment (for a not-yet-assigned row) and marks it validated, ready
   *  for Purchase Request prep. ID/Proposed Subject ID are the most
   *  reliable columns for the upload to match on, but aren't required --
   *  Title (this item) and Course Code/Course Title (the proposed course)
   *  work too, e.g. if a reviewer rebuilds this sheet from scratch with
   *  only the columns they actually have. */
  async function exportForValidation() {
    setExportingValidation(true);
    try {
      const XLSX = await import("xlsx");
      const subjectById = new Map(allSubjects.map(s => [s.subject_id, s]));
      const headers = [
        "ID", "Item Type", "Title", "Author / Subject Area", "Publisher", "Year",
        "Program", "Course Code", "Course Title", "Proposed Subject ID",
        "Supplier", "Unit Cost", "Quantity", "Total", "Canvass Date",
        "Already Validated", "Validate? (Y/N)",
      ];
      const aoa = [headers, ...rows.map(r => {
        const proposedId = r.subject_id ?? (assignments.get(r.id) ? Number(assignments.get(r.id)) : null);
        const proposed = proposedId != null ? subjectById.get(proposedId) : undefined;
        return [
          r.id, r.item_type, r.title,
          r.item_type === "journal" ? r.subject_area : r.author,
          r.publisher, r.year,
          proposed?.program ?? "", proposed?.course_code ?? "", proposed?.course_title ?? "", proposedId ?? "",
          r.supplier, r.unit_cost, r.quantity, r.unit_cost * r.quantity,
          r.canvass_date || r.created_at.slice(0, 10),
          r.validated ? "Yes" : "No", "",
        ];
      })];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 2, 12) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Canvassing");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `canvassing_validation_${todayStr()}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    } finally {
      setExportingValidation(false);
    }
  }

  function normText(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }

  /** Resolves a parsed row's canvassing_id: its own ID column if present,
   *  else an exact (case/whitespace-insensitive) match on Title against
   *  the currently loaded canvassing rows. Ambiguous or missing titles are
   *  reported back rather than guessed at, since this feeds a real
   *  purchase document. */
  function resolveCanvassingId(pr: CanvassingValidateRow): { id: number | null; reason?: string } {
    if (pr.id != null) return { id: pr.id };
    if (!pr.title) return { id: null, reason: "No ID or Title to match against." };
    const key = normText(pr.title);
    const matches = rows.filter(r => normText(r.title) === key);
    if (matches.length === 1) return { id: matches[0].id };
    if (matches.length === 0) return { id: null, reason: `Title not found among canvassed items: "${pr.title}"` };
    return { id: null, reason: `"${pr.title}" matches ${matches.length} canvassed items -- add an ID column to disambiguate.` };
  }

  /** Resolves a parsed row's target subject_id -- Course Code/Course Title
   *  text takes priority over the numeric Proposed Subject ID whenever
   *  either is filled in, specifically so a reviewer can reassign a title
   *  to a DIFFERENT course than the one originally downloaded just by
   *  editing that cell: if the numeric ID won instead, an edited Course
   *  Code/Title would be silently ignored in favor of the stale original
   *  proposal still sitting in the ID column. Course Code is checked
   *  (optionally scoped by Program) against every subject -- not just
   *  gaps, since an already-compliant subject is still a valid target --
   *  then Course Title exact, then the same relevanceScore heuristic this
   *  tab already trusts for its own auto-suggestion (but only its
   *  exact-phrase tier, score 1000, since a wrong guess here would
   *  misdirect real money). Only once BOTH text columns are blank does
   *  this fall back to the numeric ID. An unresolvable (not found or
   *  ambiguous) Course Code/Title is reported as-is rather than silently
   *  falling back to the ID -- that text was very likely a deliberate
   *  edit, so guessing past it would be worse than flagging it. */
  function resolveSubjectId(pr: CanvassingValidateRow): { subject_id: number | null; reason?: string } {
    if (pr.course_code || pr.course_title) {
      const programKey = pr.program ? normText(pr.program) : null;
      const pool = programKey ? allSubjects.filter(s => normText(s.program) === programKey) : allSubjects;
      if (pr.course_code) {
        const codeKey = normText(pr.course_code);
        const byCode = pool.filter(s => normText(s.course_code) === codeKey);
        if (byCode.length === 1) return { subject_id: byCode[0].subject_id };
        if (byCode.length > 1) return { subject_id: null, reason: `Course code "${pr.course_code}" matches ${byCode.length} courses -- add a Program column to disambiguate.` };
      }
      if (pr.course_title) {
        const titleKey = normText(pr.course_title);
        const byTitle = pool.filter(s => normText(s.course_title) === titleKey);
        if (byTitle.length === 1) return { subject_id: byTitle[0].subject_id };
        if (byTitle.length > 1) return { subject_id: null, reason: `Course "${pr.course_title}" matches ${byTitle.length} courses -- add a Program or Course Code column to disambiguate.` };
        let best: ProcurementRow | null = null, bestScore = 0;
        for (const s of pool) {
          const score = relevanceScore(pr.course_title, s);
          if (score > bestScore) { bestScore = score; best = s; }
        }
        if (best && bestScore >= 1000) return { subject_id: best.subject_id };
      }
      return { subject_id: null, reason: `Course not found: "${pr.course_code || pr.course_title}"` };
    }
    if (pr.subject_id != null) return { subject_id: pr.subject_id };
    return { subject_id: null, reason: "No Proposed Subject ID, Course Code, or Course Title to match against." };
  }

  /** Uploads a reviewed export from exportForValidation above (or a sheet a
   *  reviewer built from scratch) -- rows marked "Y" in Validate? are
   *  assigned + validated together via /api/canvassing/mass-validate. Each
   *  row is resolved by ID/Proposed Subject ID when present, falling back
   *  to Title and Course Code/Course Title text against the data already
   *  loaded in this tab (see resolveCanvassingId/resolveSubjectId above) --
   *  so a sheet with just Title and Course columns works too. */
  async function importValidationFile(file: File) {
    if (!isSpreadsheet(file)) { setValidateUploadErr("Please upload an Excel (.xlsx/.xls) or CSV file."); return; }
    setValidateUploadBusy(true); setValidateUploadErr(null); setValidateUploadMsg(null);
    try {
      const raw = await parseSheetRows(file);
      const parsedRows = buildCanvassingValidateRowsFromRaw(raw).filter(r => r.validate === true);
      if (parsedRows.length === 0) {
        setValidateUploadErr("No rows marked \"Y\" in Validate? were found.");
        return;
      }
      const items: { id: number; subject_id: number }[] = [];
      const unresolved: string[] = [];
      for (const pr of parsedRows) {
        const { id, reason: idReason } = resolveCanvassingId(pr);
        const { subject_id, reason: subjReason } = resolveSubjectId(pr);
        if (id == null || subject_id == null) {
          unresolved.push(`${pr.title || (pr.id != null ? `#${pr.id}` : "(unknown row)")} -- ${idReason || subjReason}`);
          continue;
        }
        items.push({ id, subject_id });
      }
      if (items.length === 0) {
        setValidateUploadErr(`Couldn't resolve any "Y" rows:\n${unresolved.slice(0, 15).join("\n")}${unresolved.length > 15 ? `\n…and ${unresolved.length - 15} more.` : ""}`);
        return;
      }
      const res = await apiFetch("/api/canvassing/mass-validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      let msg = `${j.validated} entr${j.validated === 1 ? "y" : "ies"} validated`;
      const serverSkipped = j.skipped?.length ?? 0;
      if (serverSkipped) msg += `, ${serverSkipped} skipped (out of your assigned campus, or not found)`;
      if (unresolved.length) msg += `, ${unresolved.length} skipped (couldn't resolve title/course):\n${unresolved.slice(0, 15).join("\n")}${unresolved.length > 15 ? `\n…and ${unresolved.length - 15} more.` : ""}`;
      setValidateUploadMsg(msg + (serverSkipped || unresolved.length ? "" : "."));
      reload();
    } catch (e) {
      setValidateUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setValidateUploadBusy(false);
    }
  }

  function toggleAssignedSelection(id: number) {
    setSelectedAssignedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllAssigned(ids: number[]) {
    setSelectedAssignedIds(new Set(ids));
  }

  function invertAssignedSelection(ids: number[]) {
    setSelectedAssignedIds(prev => new Set(ids.filter(id => !prev.has(id))));
  }

  async function massValidateSelected() {
    const targets = assigned.filter(r => selectedAssignedIds.has(r.id) && r.subject_id != null);
    if (targets.length === 0) return;
    setBulkActionBusy(true);
    try {
      const res = await apiFetch("/api/canvassing/mass-validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: targets.map(r => ({ id: r.id, subject_id: r.subject_id })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setSelectedAssignedIds(new Set());
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function massRemoveSelected() {
    const ids = Array.from(selectedAssignedIds);
    if (ids.length === 0) return;
    if (!confirm(`Unassign ${ids.length} selected title${ids.length === 1 ? "" : "s"}? They'll go back to "needs sourcing" -- nothing is deleted.`)) return;
    setBulkActionBusy(true);
    try {
      const res = await apiFetch("/api/canvassing/mass-unassign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setSelectedAssignedIds(new Set());
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function del(id: number) {
    if (!confirm("Delete this entry?")) return;
    await apiFetch(`/api/canvassing?id=${id}`, { method: "DELETE" });
    setRows(r => r.filter(x => x.id !== id));
  }

  async function linkSubject(canvassingId: number, subjectId: string) {
    if (!subjectId) return;
    setLinkBusy(true);
    try {
      const res = await apiFetch("/api/canvassing/link-subject", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvassing_id: canvassingId, subject_id: Number(subjectId) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { setErr(j.error || `HTTP ${res.status}`); return; }
      setLinkingId(null);
      reload();
    } finally { setLinkBusy(false); }
  }

  async function unlinkSubject(canvassingId: number, subjectId: number) {
    await apiFetch(`/api/canvassing/link-subject?canvassing_id=${canvassingId}&subject_id=${subjectId}`, { method: "DELETE" });
    reload();
  }

  function startReverify(r: CanvassingRow) {
    setReverifyingId(r.id);
    setReverifyValue(String(r.unit_cost));
  }

  async function saveReverify(id: number) {
    const price = parseFloat(reverifyValue);
    if (!Number.isFinite(price) || price < 0) return;
    setReverifyBusy(true);
    try {
      const res = await apiFetch(`/api/canvassing?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit_cost: price }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setReverifyingId(null);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReverifyBusy(false);
    }
  }

  // Separate assigned vs unassigned
  const assigned = useMemo(() => rows.filter(r => r.subject_id), [rows]);
  const unassigned = useMemo(() => rows.filter(r => !r.subject_id), [rows]);
  const totalCost = assigned.reduce((s, r) => s + r.unit_cost * r.quantity, 0);

  // Drop any selected id that's no longer in the assigned list (reloaded,
  // unassigned, or deleted out from under the bulk-select checkboxes).
  useEffect(() => {
    const stillAssigned = new Set(assigned.map(r => r.id));
    setSelectedAssignedIds(prev => {
      const next = new Set(Array.from(prev).filter(id => stillAssigned.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [assigned]);

  const supplierOptions = useMemo(() => Array.from(new Set(assigned.map(r => r.supplier).filter(Boolean))).sort(), [assigned]);
  const programOptions = useMemo(() => Array.from(new Set(assigned.map(r => r.program).filter(Boolean))).sort(), [assigned]);

  // Filter + sort first (this is what narrows down "which titles to buy"),
  // then group -- group order/subtotals reflect the filtered, sorted set.
  const filteredSortedAssigned = useMemo(() => {
    let list = assigned;
    if (supplierFilter) list = list.filter(r => r.supplier === supplierFilter);
    if (programFilter) list = list.filter(r => r.program === programFilter);
    if (sortBy === "none") return list;
    const sorted = [...list];
    if (sortBy === "price_asc") sorted.sort((a, b) => a.unit_cost - b.unit_cost);
    else if (sortBy === "price_desc") sorted.sort((a, b) => b.unit_cost - a.unit_cost);
    else if (sortBy === "title_asc") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === "date_desc") sorted.sort((a, b) => (b.canvass_date || b.created_at).localeCompare(a.canvass_date || a.created_at));
    else if (sortBy === "date_asc") sorted.sort((a, b) => (a.canvass_date || a.created_at).localeCompare(b.canvass_date || b.created_at));
    return sorted;
  }, [assigned, supplierFilter, programFilter, sortBy]);

  const filteredTotalCost = filteredSortedAssigned.reduce((s, r) => s + r.unit_cost * r.quantity, 0);

  const assignedGroups = useMemo(() => groupRows(filteredSortedAssigned, assignedGroupBy, (r) => {
    if (assignedGroupBy === "program") return r.program;
    if (assignedGroupBy === "supplier") return r.supplier;
    if (assignedGroupBy === "year") return yearOf(r.canvass_date || r.created_at);
    return "";
  }), [filteredSortedAssigned, assignedGroupBy]);

  // Gap subjects grouped by program for the dropdown.
  // Computed unconditionally (before the needsMigration early return below) so
  // every render calls the same hooks in the same order — hooks can't live
  // after a conditional return, or React throws "rendered fewer hooks than
  // expected" the moment needsMigration flips to true.
  const gapsByProgram = useMemo(() => {
    const map = new Map<string, { program_id: number; subjects: ProcurementRow[] }>();
    for (const g of gaps) {
      if (!map.has(g.program)) map.set(g.program, { program_id: g.program_id, subjects: [] });
      map.get(g.program)!.subjects.push(g);
    }
    return Array.from(map.entries());
  }, [gaps]);

  // Every subject still needing procurement (per official compliance data,
  // same list as Procurement Analysis' "Needs procurement" filter), not
  // just the ones that happen to have a canvassed candidate -- this is what
  // makes courses with zero canvassed titles yet visible at all, since
  // otherwise they'd never appear anywhere in this tab. "sourced" = how many
  // canvassing entries are currently assigned to that subject (already
  // found, just not purchased/uploaded yet).
  const sourcedCountBySubject = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) {
      if (r.subject_id != null) m.set(r.subject_id, (m.get(r.subject_id) ?? 0) + 1);
    }
    return m;
  }, [rows]);
  const gapsWithSourcing = useMemo(() => {
    return gaps
      .map(g => ({ ...g, sourced: sourcedCountBySubject.get(g.subject_id) ?? 0 }))
      .sort((a, b) => a.sourced - b.sourced || a.program.localeCompare(b.program) || a.course_code.localeCompare(b.course_code));
  }, [gaps, sourcedCountBySubject]);

  if (needsMigration) {
    return (
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Market Canvassing — Setup Required</h2>
        <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-3">
          <p className="text-sm font-semibold text-amber-800 mb-1">The <code>canvassing</code> table does not exist in your Supabase database.</p>
          <p className="text-xs text-amber-700">Go to <strong>Supabase → SQL Editor</strong>, paste and run the SQL below, then click Retry.</p>
        </div>
        <pre className="bg-slate-900 text-green-300 text-xs rounded p-4 overflow-x-auto whitespace-pre-wrap select-all">{MIGRATION_SQL}</pre>
        <div className="flex gap-3 mt-4">
          <button className="btn-outline text-sm" onClick={() => { setNeedsMigration(false); reload(); }}>Retry</button>
          <button className="text-sm text-slate-500 underline" onClick={() => navigator.clipboard.writeText(MIGRATION_SQL)}>Copy SQL</button>
        </div>
      </div>
    );
  }

  const displayedGapsWithSourcing = showOnlyUnsourced ? gapsWithSourcing.filter(g => g.sourced === 0) : gapsWithSourcing;
  const unsourcedCount = gapsWithSourcing.filter(g => g.sourced === 0).length;

  return (
    <div className="space-y-4">
      {/* Every subject still needing procurement -- not just ones with a
          canvassed candidate already, so a course nobody has canvassed
          anything for yet is still visible and actionable. */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-psu font-semibold">Still Needs Procurement</h2>
          <label className="text-xs text-slate-600 flex items-center gap-1.5">
            <input type="checkbox" checked={showOnlyUnsourced} onChange={e => setShowOnlyUnsourced(e.target.checked)} />
            Only courses with nothing canvassed yet ({unsourcedCount})
          </label>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Every course still short on recent titles per Procurement Analysis. "Sourced" is how many canvassing
          entries are already assigned to it (found, but not yet purchased/uploaded) -- 0 means nobody has
          canvassed anything for this course yet.
        </p>
        {loadingGaps && <p className="text-slate-400 text-xs">Loading…</p>}
        {!loadingGaps && displayedGapsWithSourcing.length === 0 && (
          <p className="text-slate-500 text-sm">{showOnlyUnsourced ? "Every course with a gap has at least one canvassed candidate." : "No courses currently need procurement."}</p>
        )}
        {!loadingGaps && displayedGapsWithSourcing.length > 0 && (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2">Program</th>
                  <th className="py-1 pr-2">Course</th>
                  <th className="py-1 px-2 text-right">Titles Needed</th>
                  <th className="py-1 px-2 text-right">Sourced</th>
                  <th className="py-1 pl-2">Status</th>
                  <th className="py-1 pl-2">Faculty Suggested</th>
                </tr>
              </thead>
              <tbody>
                {displayedGapsWithSourcing.map(g => {
                  const recs = recommendationsBySubject.get(g.subject_id) ?? [];
                  return (
                  <tr key={g.subject_id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2 text-slate-500">{g.program}</td>
                    <td className="py-1.5 pr-2 font-medium">{g.course_code} — {g.course_title}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{g.gap}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{g.sourced}</td>
                    <td className="py-1.5 pl-2">
                      {g.sourced === 0 ? (
                        <span className="inline-block bg-red-100 text-red-700 rounded px-1.5 py-0.5 text-[10px] font-medium">Needs sourcing</span>
                      ) : g.sourced < g.gap ? (
                        <span className="inline-block bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 text-[10px] font-medium">Partially sourced</span>
                      ) : (
                        <span className="inline-block bg-green-100 text-green-700 rounded px-1.5 py-0.5 text-[10px] font-medium">Sourced, pending purchase</span>
                      )}
                      {g.pending_titles > 0 && (
                        <span className="block text-[10px] text-slate-400 mt-0.5" title="Already on an active Purchase Request or Purchase Order -- don't canvass/request more for this gap without checking it first.">
                          {g.pending_titles} already ordered
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-slate-600 max-w-[220px]">
                      {recs.length > 0 && (
                        <span title={recs.map(r => `${r.title}${r.author ? ` — ${r.author}` : ""}`).join("\n")}>
                          {recs.slice(0, 2).map(r => r.title).join("; ")}
                          {recs.length > 2 ? ` +${recs.length - 2} more` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SupplierOffersReview />

      {/* Upload */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Upload Canvassing File</h2>
        <p className="text-xs text-slate-500 mb-2">
          Upload an Excel or CSV of market-canvassed titles. After import, assign each title to the subject gap it addresses.
        </p>
        <div className="flex items-center gap-4 mb-2 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="upload-type" checked={uploadType === "book"} onChange={() => { setUploadType("book"); setParsed([]); }} />
            Books
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="upload-type" checked={uploadType === "journal"} onChange={() => { setUploadType("journal"); setParsed([]); }} />
            Journals &amp; Periodicals
          </label>
        </div>
        <p className="text-xs text-slate-500 mb-1">
          Expected columns: {uploadType === "journal"
            ? <span className="font-medium">Subject Area, Title, Issue, Year, Manila Price, Provincial Price, Supplier</span>
            : <span className="font-medium">Title, Author, Publisher, Year, Price, Supplier</span>}
          &nbsp;(+ optional: Unit, Quantity, Stock No, Notes{uploadType === "book" ? ", ISBN" : ""})
          {uploadType === "journal" && " -- the Provincial Price becomes the working unit cost used on Purchase Requests/Orders; Manila Price is kept as a reference only."}
        </p>
        <div className="flex gap-2 mb-4 text-xs">
          <span className="text-slate-400">Download template:</span>
          <button className="text-psu underline" onClick={() => downloadTemplate("xlsx", uploadType)}>XLSX</button>
          <button className="text-psu underline" onClick={() => downloadTemplate("csv", uploadType)}>CSV</button>
        </div>
        <div className="flex flex-wrap gap-3 mb-3">
          <label className="label flex-col items-start gap-1">
            <span>Date of Canvass *</span>
            <input className="input" type="date" value={canvassDate} onChange={e => setCanvassDate(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1">
            <span>Canvassing file</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="text-xs"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </label>
        </div>
        {parsing && <p className="text-slate-500 text-sm">Parsing file…</p>}
        {uploadErr && <p className="text-red-700 text-sm mb-2">{uploadErr}</p>}
        {parsed.length > 0 && (
          <>
            <div className="overflow-x-auto mb-3">
              <p className="text-sm text-slate-600 mb-1"><span className="font-semibold">{parsed.length} {uploadType === "journal" ? "periodicals" : "titles"}</span> parsed — preview (first 5):</p>
              <table className="w-full text-xs">
                {uploadType === "journal" ? (
                  <>
                    <thead><tr className="border-b border-slate-200 text-slate-500 text-left">
                      <th className="py-1 pr-2">Subject Area</th><th className="py-1 pr-2">Title</th><th className="py-1 pr-2">Issue</th>
                      <th className="py-1 px-2 text-right">Manila</th><th className="py-1 px-2 text-right">Provincial</th>
                    </tr></thead>
                    <tbody>{parsed.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 pr-2 text-slate-600">{r.subject_area}</td>
                        <td className="py-1 pr-2 font-medium">{r.title}</td>
                        <td className="py-1 pr-2 text-slate-600">{r.issue}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.manila_price != null ? `₱${r.manila_price.toFixed(2)}` : "—"}</td>
                        <td className="py-1 px-2 text-right tabular-nums font-medium">{r.provincial_price != null ? `₱${r.provincial_price.toFixed(2)}` : "—"}</td>
                      </tr>
                    ))}</tbody>
                  </>
                ) : (
                  <>
                    <thead><tr className="border-b border-slate-200 text-slate-500 text-left">
                      <th className="py-1 pr-2">Title</th><th className="py-1 pr-2">Author</th>
                      <th className="py-1 pr-2">Supplier</th><th className="py-1 px-2 text-right">Price</th>
                    </tr></thead>
                    <tbody>{parsed.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 pr-2 font-medium">{r.title}</td>
                        <td className="py-1 pr-2 text-slate-600">{r.author}</td>
                        <td className="py-1 pr-2 text-slate-600">{r.supplier}</td>
                        <td className="py-1 px-2 text-right tabular-nums">₱{r.unit_cost.toFixed(2)}</td>
                      </tr>
                    ))}</tbody>
                  </>
                )}
              </table>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline text-sm" disabled={uploading} onClick={importParsed}>
                {uploading ? "Importing…" : `Import all ${parsed.length} ${uploadType === "journal" ? "periodicals" : "titles"}`}
              </button>
              <button className="text-sm text-slate-500 hover:text-slate-700" onClick={() => setParsed([])}>Cancel</button>
            </div>
          </>
        )}
      </div>

      {/* Mass Validate — download proposed assignments, review offline, upload to confirm+validate */}
      {rows.length > 0 && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-1">Mass Validate Assignments</h2>
          <p className="text-xs text-slate-500 mb-3">
            Download every canvassed title with its currently proposed course (already assigned, or just the
            best-guess suggestion below), mark <span className="font-medium">Validate? (Y/N)</span> for each one a
            reviewer approves, then upload it back -- that confirms the assignment and marks it validated in one
            pass. Only <span className="font-medium">validated</span> titles are pulled into Purchase Request prep.
            To assign a title to a <span className="font-medium">different</span> course than the one proposed, just
            edit its Course Code or Course Title cell before uploading -- that edit wins over whatever was
            originally in Proposed Subject ID. Don&apos;t have the ID/Proposed Subject ID columns at all (e.g.
            building this sheet yourself)? That&apos;s fine -- just <span className="font-medium">Title</span>{" "}
            (matching an existing canvassed item) and <span className="font-medium">Course Code or Course Title</span>{" "}
            (matching an existing course) also work, as long as they match exactly one item/course each.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-outline text-sm" disabled={exportingValidation} onClick={exportForValidation}>
              {exportingValidation ? "Preparing…" : "Download for Validation (XLSX)"}
            </button>
            <label className="label flex-col items-start gap-1">
              <span>Upload validated list</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="text-xs" disabled={validateUploadBusy}
                onChange={e => { const f = e.target.files?.[0]; if (f) importValidationFile(f); e.target.value = ""; }} />
            </label>
          </div>
          {validateUploadBusy && <p className="text-slate-500 text-xs mt-2">Uploading…</p>}
          {validateUploadMsg && <p className="text-green-700 text-xs mt-2 whitespace-pre-wrap">{validateUploadMsg}</p>}
          {validateUploadErr && <p className="text-red-700 text-xs mt-2 whitespace-pre-wrap">{validateUploadErr}</p>}
        </div>
      )}

      {/* Gap Matching — unassigned titles */}
      {rows.length > 0 && unassigned.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-psu font-semibold">Match Titles to Subject Gaps</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Assign each canvassed title to the subject it will help fill. Dropdowns are pre-suggested by keyword match.
              </p>
            </div>
            <button
              className="btn-outline text-sm whitespace-nowrap"
              disabled={saving || gaps.length === 0}
              onClick={saveAssignments}
            >
              {saving ? "Saving…" : `Confirm ${unassigned.length} assignment${unassigned.length !== 1 ? "s" : ""}`}
            </button>
          </div>
          {loadingGaps && <p className="text-slate-400 text-xs">Loading gaps…</p>}
          {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Supplier</th>
                  <th className="py-1 px-2 text-right">Price</th>
                  <th className="py-1 pl-2 min-w-[300px]">Assign to Subject Gap</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-1.5 pr-2 font-medium">
                      {r.title}
                      {r.item_type === "journal" && (
                        <span className="ml-1.5 inline-block bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 text-[10px] font-normal" title={r.subject_area ? `Subject area: ${r.subject_area}` : undefined}>
                          Journal{r.issue ? ` · ${r.issue}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.item_type === "journal" ? r.subject_area : `${r.author}${r.year ? `, ${r.year}` : ""}`}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.supplier}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">₱{r.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                    <td className="py-1.5 pl-2">
                      <SearchableSelect
                        className="input text-xs w-full"
                        placeholder="Type to search a course…"
                        value={assignments.get(r.id) ?? ""}
                        onChange={v => setAssignments(prev => new Map(prev).set(r.id, v))}
                        groups={gapsByProgram.map(([prog, { subjects }]) => ({
                          label: prog,
                          options: subjects.map(g => ({
                            value: String(g.subject_id),
                            label: `${g.course_code} — ${g.course_title} (needs +${g.gap})`,
                          })),
                        }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assigned titles — ready for PR */}
      {assigned.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-psu font-semibold">Matched & Ready for Purchase Request</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {(supplierFilter || programFilter)
                  ? <>{filteredSortedAssigned.length} of {assigned.length} titles shown · Total: ₱{money(filteredTotalCost)}</>
                  : <>{assigned.length} titles matched to subject gaps · Total: ₱{money(totalCost)}</>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Supplier:
                <select className="input text-xs py-1" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                  <option value="">All suppliers</option>
                  {supplierOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Program:
                <select className="input text-xs py-1" value={programFilter} onChange={e => setProgramFilter(e.target.value)}>
                  <option value="">All programs</option>
                  {programOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Sort by:
                <select className="input text-xs py-1" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="none">Default</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="title_asc">Title A-Z</option>
                  <option value="date_desc">Newest canvassed</option>
                  <option value="date_asc">Oldest canvassed</option>
                </select>
              </label>
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Group by:
                <select className="input text-xs py-1" value={assignedGroupBy} onChange={e => setAssignedGroupBy(e.target.value as typeof assignedGroupBy)}>
                  <option value="none">None</option>
                  <option value="program">Program</option>
                  <option value="supplier">Supplier</option>
                  <option value="year">Year</option>
                </select>
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-2 text-xs">
            <span className="text-slate-500">{selectedAssignedIds.size} selected</span>
            <button className="text-psu underline" onClick={() => selectAllAssigned(filteredSortedAssigned.map(r => r.id))}>
              Select all{(supplierFilter || programFilter) ? " (filtered)" : ""}
            </button>
            <button className="text-psu underline" onClick={() => invertAssignedSelection(filteredSortedAssigned.map(r => r.id))}>
              Invert selection
            </button>
            <button className="text-slate-400 underline" onClick={() => setSelectedAssignedIds(new Set())}>Clear</button>
            <button
              className="btn-outline text-[11px] px-2 py-1 ml-2"
              disabled={bulkActionBusy || selectedAssignedIds.size === 0}
              onClick={massValidateSelected}
              title="Marks each selected title validated, using its current course assignment as-is"
            >
              {bulkActionBusy ? "Working…" : `Mass Validate (${selectedAssignedIds.size})`}
            </button>
            <button
              className="btn-outline text-[11px] px-2 py-1 text-amber-700 border-amber-300"
              disabled={bulkActionBusy || selectedAssignedIds.size === 0}
              onClick={massRemoveSelected}
              title="Unassigns each selected title -- sends it back to needs-sourcing without deleting it"
            >
              {bulkActionBusy ? "Working…" : `Mass Remove (${selectedAssignedIds.size})`}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={filteredSortedAssigned.length > 0 && filteredSortedAssigned.every(r => selectedAssignedIds.has(r.id))}
                      onChange={e => e.target.checked ? selectAllAssigned(filteredSortedAssigned.map(r => r.id)) : setSelectedAssignedIds(new Set())}
                    />
                  </th>
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Subject Gap Addressed</th>
                  <th className="py-1 pr-2">Program</th>
                  <th className="py-1 pr-2">Supplier</th>
                  <th className="py-1 px-2 text-right">Unit Cost</th>
                  <th className="py-1 px-2" title={`Prices older than ${PRICE_VALIDITY_DAYS} days are flagged for re-verification`}>Quoted</th>
                  <th className="py-1 px-2 text-right">Qty</th>
                  <th className="py-1 px-2 text-right">Total</th>
                  <th className="py-1 px-2" title="Only validated titles are pulled into Purchase Request prep">Validated</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {assignedGroups.flatMap(([label, groupItems]) => [
                  ...(assignedGroupBy !== "none" ? [
                    <tr key={`g-${label}`} className="bg-slate-50">
                      <td colSpan={12} className="py-1 px-2 font-semibold text-slate-600">
                        {label} · {groupItems.length} · ₱{money(groupItems.reduce((s, r) => s + r.unit_cost * r.quantity, 0))}
                      </td>
                    </tr>,
                  ] : []),
                  ...groupItems.map(r => {
                    const priceDate = r.canvass_date || r.created_at;
                    const stale = isPriceStale(priceDate);
                    return (
                    <tr key={r.id} className={"border-b border-slate-100 " + (stale ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-green-50")}>
                      <td className="py-1.5 pr-2">
                        <input type="checkbox" checked={selectedAssignedIds.has(r.id)} onChange={() => toggleAssignedSelection(r.id)} />
                      </td>
                      <td className="py-1.5 pr-2 font-medium">
                        {r.title}
                        {r.item_type === "journal" && (
                          <span className="ml-1.5 inline-block bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 text-[10px] font-normal" title={r.subject_area ? `Subject area: ${r.subject_area}` : undefined}>
                            Journal{r.issue ? ` · ${r.issue}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.item_type === "journal" ? r.subject_area : `${r.author}${r.year ? `, ${r.year}` : ""}`}</td>
                      <td className="py-1.5 pr-2 text-psu font-medium">
                        <div>{r.subject_label}</div>
                        {r.additional_subjects.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {r.additional_subjects.map(a => (
                              <span key={a.subject_id} className="inline-flex items-center gap-1 bg-psu-light text-psu rounded px-1.5 py-0.5 text-[10px] font-normal">
                                {a.course_code || a.course_title}
                                <button type="button" className="text-psu/60 hover:text-red-600" title="Unlink" onClick={() => unlinkSubject(r.id, a.subject_id)}>×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        {linkingId === r.id ? (
                          <div className="mt-1 flex items-center gap-1">
                            <SearchableSelect
                              value=""
                              onChange={(v) => linkSubject(r.id, v)}
                              groups={gapsByProgram.map(([prog, { subjects }]) => ({
                                label: prog,
                                options: subjects
                                  .filter(g => g.subject_id !== r.subject_id && !r.additional_subjects.some(a => a.subject_id === g.subject_id))
                                  .map(g => ({ value: String(g.subject_id), label: `${g.course_code} — ${g.course_title}` })),
                              }))}
                              placeholder="Search a course…"
                              className="input w-48 text-[11px] py-0.5"
                            />
                            <button type="button" className="text-slate-400 text-[10px] underline" disabled={linkBusy} onClick={() => setLinkingId(null)}>x</button>
                          </div>
                        ) : (
                          <button type="button" className="text-[10px] text-psu underline mt-1" onClick={() => setLinkingId(r.id)}>
                            + link to another course
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.supplier}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {reverifyingId === r.id ? (
                          <div className="flex items-center gap-1 justify-end">
                            <input type="number" min="0" step="0.01" className="input w-20 text-right text-xs py-0.5"
                              value={reverifyValue} onChange={e => setReverifyValue(e.target.value)} autoFocus />
                            <button className="text-psu text-[10px] underline" disabled={reverifyBusy} onClick={() => saveReverify(r.id)}>Save</button>
                            <button className="text-slate-400 text-[10px] underline" onClick={() => setReverifyingId(null)}>x</button>
                          </div>
                        ) : (
                          <>₱{r.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        {stale ? (
                          <span className="inline-block bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 text-[10px] font-medium" title={`Quoted ${priceDate} -- verify with supplier before ordering`}>
                            {daysSincePriced(priceDate)}d ago — verify
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">{daysSincePriced(priceDate)}d ago</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{r.quantity}</td>
                      <td className="py-1.5 px-2 text-right font-semibold tabular-nums">₱{(r.unit_cost * r.quantity).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 px-2">
                        {r.validated ? (
                          <span className="inline-block bg-green-100 text-green-700 rounded px-1.5 py-0.5 text-[10px] font-medium">Validated</span>
                        ) : (
                          <span className="inline-block bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 text-[10px] font-medium">Pending</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 whitespace-nowrap">
                        {reverifyingId !== r.id && (
                          <button className="text-psu text-[11px] underline mr-2" onClick={() => startReverify(r)}>Re-verify</button>
                        )}
                        <button className="text-amber-600 text-[11px] underline mr-2" onClick={() => unassign(r.id)}>Unmatch</button>
                        <button className="text-red-500 text-[11px] underline" onClick={() => del(r.id)}>Delete</button>
                      </td>
                    </tr>
                    );
                  }),
                ])}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card">
          <p className="text-slate-500 text-sm">No canvassing entries yet. Upload a file above.</p>
        </div>
      )}
    </div>
  );
}

const OFFER_STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  accepted: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
};

/** Pending offers suppliers have submitted against a need -- review and
 *  accept/decline. Shown to whoever can view/edit Market Canvassing. */
function SupplierOffersReview() {
  const [offers, setOffers] = useState<SupplierOfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [groupBy, setGroupBy] = useState<"none" | "program" | "supplier" | "year">("none");

  function load() {
    setLoading(true);
    apiFetch("/api/supplier/offers")
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setOffers(j.rows ?? []); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function decide(id: number, status: "accepted" | "declined") {
    setBusyId(id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/supplier/offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const displayed = showAll ? offers : offers.filter((o) => o.status === "pending");
  const groups = groupRows(displayed, groupBy, (o) => {
    if (groupBy === "program") return o.program ?? "";
    if (groupBy === "supplier") return o.supplier_email;
    if (groupBy === "year") return yearOf(o.created_at);
    return "";
  });
  if (loading || (offers.length === 0 && !err)) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-psu font-semibold">Supplier Offers</h2>
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            Group by:
            <select className="input text-xs py-1" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
              <option value="none">None</option>
              <option value="program">Program</option>
              <option value="supplier">Supplier</option>
              <option value="year">Year</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show accepted/declined too
          </label>
        </div>
      </div>
      {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
      {displayed.length === 0 && <p className="text-slate-500 text-sm">No pending offers.</p>}
      {displayed.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500 text-left">
              <th className="py-1 pr-2">Supplier</th>
              <th className="py-1 pr-2">Subject</th>
              <th className="py-1 pr-2">Title</th>
              <th className="py-1 px-2">Format</th>
              <th className="py-1 px-2">Faculty request</th>
              <th className="py-1 px-2 text-right">Price</th>
              <th className="py-1 px-2">Notes</th>
              <th className="py-1 pl-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(([label, groupItems]) => [
              ...(groupBy !== "none" ? [
                <tr key={`g-${label}`} className="bg-slate-50">
                  <td colSpan={8} className="py-1 px-2 font-semibold text-slate-600">{label} · {groupItems.length}</td>
                </tr>,
              ] : []),
              ...groupItems.map((o) => (
              <tr key={o.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-2 text-slate-500">{o.supplier_email}</td>
                <td className="py-1.5 pr-2 text-slate-500">{o.subject_label || "—"}</td>
                <td className="py-1.5 pr-2">{o.title}{o.author && <span className="text-slate-400"> — {o.author}</span>}</td>
                <td className="py-1.5 px-2 text-slate-500">{o.format || "—"}</td>
                <td className="py-1.5 px-2 text-slate-500">
                  {o.recommendation_id != null ? (
                    <span
                      className={"inline-block rounded px-1.5 py-0.5 text-[10px] font-medium " + (o.match_type === "alternative" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}
                      title={o.recommendation_title ? `Faculty requested: ${o.recommendation_title}` : undefined}
                    >
                      {o.match_type === "alternative" ? "Alternative" : "Exact title"}
                    </span>
                  ) : "—"}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{o.price != null ? o.price.toLocaleString() : "—"}</td>
                <td className="py-1.5 px-2 text-slate-500">{o.notes || "—"}</td>
                <td className="py-1.5 pl-2 text-right">
                  {o.status === "pending" ? (
                    <div className="flex gap-1 justify-end">
                      <button className="text-green-700 text-[11px] underline" disabled={busyId === o.id} onClick={() => decide(o.id, "accepted")}>Accept</button>
                      <button className="text-red-600 text-[11px] underline" disabled={busyId === o.id} onClick={() => decide(o.id, "declined")}>Decline</button>
                    </div>
                  ) : (
                    <span className={"inline-block rounded px-1.5 py-0.5 text-[10px] font-medium " + OFFER_STATUS_COLOR[o.status]}>
                      {o.status === "accepted" ? "Accepted" : "Declined"}
                    </span>
                  )}
                </td>
              </tr>
              )),
            ])}
          </tbody>
        </table>
      )}
    </div>
  );
}
