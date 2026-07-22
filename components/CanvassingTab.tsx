"use client";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import { parseSheetRows, isSpreadsheet } from "@/lib/parse-client";
import type { CanvassingRow } from "@/app/api/canvassing/route";
import type { ProcurementRow } from "@/app/api/procurement/route";

function todayStr() { return new Date().toISOString().slice(0, 10); }

// Simple keyword relevance: how many meaningful words in the canvassing title
// appear in the subject's course title / code.
function relevanceScore(canvTitle: string, subject: ProcurementRow): number {
  const STOP = new Set(["the","and","of","in","to","a","an","for","on","with","by","at","as","is","are","be","or","it","its","from","that","this","into","has","have","not","but","was","were","can","all","more","their","they","been","also","over","some","such","than","then","these","those","when","will","your","our","per"]);
  const words = (s: string) => s.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP.has(w));
  const titleW = new Set(words(canvTitle));
  const subjectW = new Set(words(subject.course_title + " " + subject.course_code));
  let hits = 0;
  titleW.forEach(w => { if (subjectW.has(w)) hits++; });
  return hits;
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

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Load gaps whenever canvassing rows are available
  useEffect(() => { if (rows.length > 0) loadGaps(); }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate assignment dropdowns with best keyword match
  useEffect(() => {
    if (gaps.length === 0 || rows.length === 0) return;
    const init = new Map<number, string>();
    for (const r of rows) {
      if (r.subject_id) {
        init.set(r.id, String(r.subject_id)); // already assigned
      } else {
        // Find best matching subject
        let best = gaps[0];
        let bestScore = -1;
        for (const g of gaps) {
          const s = relevanceScore(r.title, g);
          if (s > bestScore) { bestScore = s; best = g; }
        }
        init.set(r.id, String(best.subject_id));
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

  // Separate assigned vs unassigned
  const assigned = useMemo(() => rows.filter(r => r.subject_id), [rows]);
  const unassigned = useMemo(() => rows.filter(r => !r.subject_id), [rows]);
  const totalCost = assigned.reduce((s, r) => s + r.unit_cost * r.quantity, 0);

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

  return (
    <div className="space-y-4">
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
                      <select
                        className="input text-xs w-full"
                        value={assignments.get(r.id) ?? ""}
                        onChange={e => setAssignments(prev => new Map(prev).set(r.id, e.target.value))}
                      >
                        <option value="">— select subject —</option>
                        {gapsByProgram.map(([prog, { subjects }]) => (
                          <optgroup key={prog} label={prog}>
                            {subjects.map(g => (
                              <option key={g.subject_id} value={g.subject_id}>
                                {g.course_code} — {g.course_title} (needs +{g.gap})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
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
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-psu font-semibold">Matched & Ready for Purchase Request</h2>
              <p className="text-xs text-slate-500 mt-0.5">{assigned.length} titles matched to subject gaps · Total: ₱{totalCost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>
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
                  <th className="py-1 px-2 text-right">Qty</th>
                  <th className="py-1 px-2 text-right">Total</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {assigned.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-green-50">
                    <td className="py-1.5 pr-2 font-medium">{r.title}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.author}{r.year ? `, ${r.year}` : ""}</td>
                    <td className="py-1.5 pr-2 text-psu font-medium">{r.subject_label}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.supplier}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">₱{r.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.quantity}</td>
                    <td className="py-1.5 px-2 text-right font-semibold tabular-nums">₱{(r.unit_cost * r.quantity).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                    <td className="py-1.5 pl-2">
                      <button className="text-amber-600 text-[11px] underline mr-2" onClick={() => unassign(r.id)}>Unmatch</button>
                      <button className="text-red-500 text-[11px] underline" onClick={() => del(r.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
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
