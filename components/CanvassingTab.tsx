"use client";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import { parseSheetRows, isSpreadsheet } from "@/lib/parse-client";
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

async function downloadTemplate(fmt: "xlsx" | "csv") {
  const XLSX = await import("xlsx");
  const headers = ["Title", "Author", "Publisher", "Year", "ISBN", "Supplier", "Price", "Unit", "Quantity", "Stock No", "Notes"];
  const example = ["Introduction to Philosophy", "Popkin, Richard", "Cengage", "2020", "978-0-123456-78-9", "National Book Store", "850.00", "copy", "1", "", ""];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Canvassing");
  const buf = XLSX.write(wb, { type: "buffer", bookType: fmt });
  const blob = new Blob([buf], { type: fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `canvassing_template.${fmt}`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

type ParsedRow = {
  title: string; author: string; publisher: string; year: string; isbn: string;
  supplier: string; unit: string; stock_prop_no: string;
  unit_cost: number; quantity: number; notes: string;
};

function mapRow(raw: Record<string, string>): ParsedRow {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.entries(raw).find(([rk]) => rk.toLowerCase() === k.toLowerCase());
      if (found && found[1] !== "") return found[1];
    }
    return "";
  };
  return {
    title: get("title", "book title", "name"),
    author: get("author", "authors"),
    publisher: get("publisher"),
    year: get("year", "publication year"),
    isbn: get("isbn"),
    supplier: get("supplier", "vendor", "store"),
    unit: get("unit") || "copy",
    stock_prop_no: get("stock no", "prop no", "stock/prop no", "stock_prop_no"),
    unit_cost: parseFloat(get("price", "unit cost", "cost", "amount") || "0") || 0,
    quantity: parseInt(get("quantity", "qty") || "1") || 1,
    notes: get("notes", "remarks"),
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
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // Gap matching
  const [gaps, setGaps] = useState<ProcurementRow[]>([]);
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
      const mapped = rawRows.map(mapRow).filter(r => r.title.trim() !== "");
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

  async function del(id: number) {
    if (!confirm("Delete this entry?")) return;
    await apiFetch(`/api/canvassing?id=${id}`, { method: "DELETE" });
    setRows(r => r.filter(x => x.id !== id));
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
        <p className="text-xs text-slate-500 mb-1">
          Upload an Excel or CSV of market-canvassed titles. After import, assign each title to the subject gap it addresses.
          Expected columns: <span className="font-medium">Title, Author, Publisher, Year, Price, Supplier</span>
          &nbsp;(+ optional: ISBN, Unit, Quantity, Stock No, Notes)
        </p>
        <div className="flex gap-2 mb-4 text-xs">
          <span className="text-slate-400">Download template:</span>
          <button className="text-psu underline" onClick={() => downloadTemplate("xlsx")}>XLSX</button>
          <button className="text-psu underline" onClick={() => downloadTemplate("csv")}>CSV</button>
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
              <p className="text-sm text-slate-600 mb-1"><span className="font-semibold">{parsed.length} titles</span> parsed — preview (first 5):</p>
              <table className="w-full text-xs">
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
              </table>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline text-sm" disabled={uploading} onClick={importParsed}>
                {uploading ? "Importing…" : `Import all ${parsed.length} titles`}
              </button>
              <button className="text-sm text-slate-500 hover:text-slate-700" onClick={() => setParsed([])}>Cancel</button>
            </div>
          </>
        )}
      </div>

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
                    <td className="py-1.5 pr-2 font-medium">{r.title}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.author}{r.year ? `, ${r.year}` : ""}</td>
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
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Subject Gap Addressed</th>
                  <th className="py-1 pr-2">Program</th>
                  <th className="py-1 pr-2">Supplier</th>
                  <th className="py-1 px-2 text-right">Unit Cost</th>
                  <th className="py-1 px-2" title={`Prices older than ${PRICE_VALIDITY_DAYS} days are flagged for re-verification`}>Quoted</th>
                  <th className="py-1 px-2 text-right">Qty</th>
                  <th className="py-1 px-2 text-right">Total</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {assignedGroups.flatMap(([label, groupItems]) => [
                  ...(assignedGroupBy !== "none" ? [
                    <tr key={`g-${label}`} className="bg-slate-50">
                      <td colSpan={10} className="py-1 px-2 font-semibold text-slate-600">
                        {label} · {groupItems.length} · ₱{money(groupItems.reduce((s, r) => s + r.unit_cost * r.quantity, 0))}
                      </td>
                    </tr>,
                  ] : []),
                  ...groupItems.map(r => {
                    const priceDate = r.canvass_date || r.created_at;
                    const stale = isPriceStale(priceDate);
                    return (
                    <tr key={r.id} className={"border-b border-slate-100 " + (stale ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-green-50")}>
                      <td className="py-1.5 pr-2 font-medium">{r.title}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.author}{r.year ? `, ${r.year}` : ""}</td>
                      <td className="py-1.5 pr-2 text-psu font-medium">{r.subject_label}</td>
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
              <th className="py-1 px-2 text-right">Price</th>
              <th className="py-1 px-2">Notes</th>
              <th className="py-1 pl-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(([label, groupItems]) => [
              ...(groupBy !== "none" ? [
                <tr key={`g-${label}`} className="bg-slate-50">
                  <td colSpan={7} className="py-1 px-2 font-semibold text-slate-600">{label} · {groupItems.length}</td>
                </tr>,
              ] : []),
              ...groupItems.map((o) => (
              <tr key={o.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-2 text-slate-500">{o.supplier_email}</td>
                <td className="py-1.5 pr-2 text-slate-500">{o.subject_label || "—"}</td>
                <td className="py-1.5 pr-2">{o.title}{o.author && <span className="text-slate-400"> — {o.author}</span>}</td>
                <td className="py-1.5 px-2 text-slate-500">{o.format || "—"}</td>
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
