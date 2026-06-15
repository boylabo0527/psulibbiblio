"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { parseSheetRows, isSpreadsheet } from "@/lib/parse-client";
import type { CanvassingRow } from "@/app/api/canvassing/route";

type Program = { id: number; name: string };

const UNIT_OPTIONS = ["copy", "piece", "set", "volume", "title"];

// Column aliases for the uploaded spreadsheet
function mapRow(raw: Record<string, string>): Partial<CanvassingRow> & { unit_cost: number; quantity: number } {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = raw[k] ?? raw[k.toLowerCase()] ?? raw[k.toUpperCase()];
      if (v !== undefined && v !== "") return v;
      // case-insensitive scan
      const found = Object.entries(raw).find(([rk]) => rk.toLowerCase() === k.toLowerCase());
      if (found) return found[1];
    }
    return "";
  };
  return {
    title: get("Title", "Book Title", "Name", "TITLE"),
    author: get("Author", "Authors", "AUTHOR"),
    publisher: get("Publisher", "PUBLISHER"),
    year: get("Year", "Publication Year", "YEAR"),
    isbn: get("ISBN", "isbn"),
    supplier: get("Supplier", "Vendor", "Store", "SUPPLIER"),
    unit: get("Unit", "UNIT") || "copy",
    stock_prop_no: get("Stock No", "Prop No", "Stock/Prop No", "stock_prop_no"),
    unit_cost: parseFloat(get("Price", "Unit Cost", "Cost", "Amount", "PRICE") || "0") || 0,
    quantity: parseInt(get("Quantity", "Qty", "QTY") || "1") || 1,
    notes: get("Notes", "Remarks", "NOTES"),
  };
}

const MIGRATION_SQL = `-- Run once in your Supabase SQL editor:
create table canvassing (
  id bigint generated always as identity primary key,
  title text not null,
  author text, publisher text, year text, isbn text,
  subject_id bigint references subjects(id),
  program_id bigint references programs(id),
  supplier text, unit text default 'copy',
  stock_prop_no text,
  unit_cost numeric(10,2) default 0,
  quantity integer default 1,
  notes text,
  created_at timestamptz default now()
);
alter table canvassing enable row level security;
create policy "service role full access" on canvassing using (true) with check (true);`;

type ParsedRow = ReturnType<typeof mapRow>;

export default function CanvassingTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [filterProgram, setFilterProgram] = useState("");
  const [rows, setRows] = useState<CanvassingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  // Upload state
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [uploadProgram, setUploadProgram] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    apiFetch("/api/programs").then(r => r.json())
      .then(j => {
        const list: Program[] = j.programs ?? [];
        setPrograms(list);
      }).catch(() => {});
  }, []);

  function reload(programId = filterProgram) {
    setLoading(true); setErr(null);
    const p = new URLSearchParams();
    if (programId) p.set("program_id", programId);
    apiFetch(`/api/canvassing?${p}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) {
          if (j.error.includes("does not exist") || j.error.includes("relation")) setNeedsMigration(true);
          else setErr(j.error);
        } else setRows(j.rows ?? []);
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, [filterProgram]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(file: File) {
    if (!isSpreadsheet(file)) { setUploadErr("Please upload an Excel (.xlsx/.xls) or CSV file."); return; }
    setParsing(true); setUploadErr(null); setParsed([]);
    try {
      const rawRows = await parseSheetRows(file);
      const mapped = rawRows.map(mapRow).filter(r => r.title && r.title.trim() !== "");
      if (mapped.length === 0) { setUploadErr("No valid rows found. Ensure the file has a Title column."); return; }
      setParsed(mapped);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  async function importParsed() {
    if (!uploadProgram) { setUploadErr("Select a program before importing."); return; }
    if (parsed.length === 0) return;
    setUploading(true); setUploadErr(null);
    try {
      const res = await apiFetch("/api/canvassing/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: Number(uploadProgram),
          rows: parsed,
        }),
      });
      const j = await res.json();
      if (j.error) { setUploadErr(j.error); return; }
      setParsed([]);
      setFilterProgram(uploadProgram);
      reload(uploadProgram);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function del(id: number) {
    if (!confirm("Delete this entry?")) return;
    await apiFetch(`/api/canvassing?id=${id}`, { method: "DELETE" });
    setRows(r => r.filter(x => x.id !== id));
  }

  if (needsMigration) {
    return (
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Market Canvassing</h2>
        <p className="text-sm text-amber-700 mb-3">The <code>canvassing</code> table does not exist yet. Run this SQL in your Supabase SQL editor:</p>
        <pre className="bg-slate-900 text-green-300 text-xs rounded p-4 overflow-x-auto whitespace-pre-wrap">{MIGRATION_SQL}</pre>
        <button className="btn-outline mt-4 text-sm" onClick={() => { setNeedsMigration(false); reload(); }}>
          Retry after running migration
        </button>
      </div>
    );
  }

  const totalCost = rows.reduce((s, r) => s + r.unit_cost * r.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Upload Canvassing File</h2>
        <p className="text-xs text-slate-500 mb-3">
          Upload an Excel or CSV file with market-canvassed titles. Expected columns:
          <span className="font-medium"> Title, Author, Publisher, Year, Price, Supplier</span>
          &nbsp;(+ optional: ISBN, Unit, Quantity, Stock No, Notes)
        </p>

        <div className="flex flex-wrap gap-3 mb-3">
          <label className="label">
            Program *
            <select className="input ml-1 min-w-[220px]" value={uploadProgram} onChange={e => setUploadProgram(e.target.value)}>
              <option value="">— select program —</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="label flex-col items-start gap-1">
            <span>Canvassing file</span>
            <input type="file" accept=".xlsx,.xls,.csv"
              className="text-xs"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </label>
        </div>

        {parsing && <p className="text-slate-500 text-sm">Parsing file…</p>}
        {uploadErr && <p className="text-red-700 text-sm mb-2">{uploadErr}</p>}

        {parsed.length > 0 && (
          <>
            <p className="text-sm text-slate-600 mb-2">
              <span className="font-semibold">{parsed.length} titles</span> parsed — preview (first 5):
            </p>
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs mb-2">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-1 pr-2">Title</th>
                    <th className="py-1 pr-2">Author</th>
                    <th className="py-1 pr-2">Publisher</th>
                    <th className="py-1 pr-2 text-center">Year</th>
                    <th className="py-1 pr-2">Supplier</th>
                    <th className="py-1 px-2 text-right">Price</th>
                    <th className="py-1 px-2 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 pr-2 font-medium">{r.title}</td>
                      <td className="py-1 pr-2 text-slate-600">{r.author}</td>
                      <td className="py-1 pr-2 text-slate-600">{r.publisher}</td>
                      <td className="py-1 pr-2 text-center text-slate-600">{r.year}</td>
                      <td className="py-1 pr-2 text-slate-600">{r.supplier}</td>
                      <td className="py-1 px-2 text-right tabular-nums">₱{r.unit_cost.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{r.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline text-sm" disabled={uploading || !uploadProgram} onClick={importParsed}>
                {uploading ? "Importing…" : `Import all ${parsed.length} titles`}
              </button>
              <button className="text-sm text-slate-500 hover:text-slate-700" onClick={() => setParsed([])}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {/* Existing entries */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-psu font-semibold">Canvassing Entries</h2>
          <label className="label">
            Filter by Program
            <select className="input ml-1 min-w-[200px]" value={filterProgram} onChange={e => setFilterProgram(e.target.value)}>
              <option value="">All programs</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}

        {!loading && rows.length === 0 && (
          <p className="text-slate-500 text-sm">No entries yet. Upload a canvassing file above.</p>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-1 pr-2">Title</th>
                    <th className="py-1 pr-2">Author</th>
                    <th className="py-1 pr-2">Publisher</th>
                    <th className="py-1 pr-2 text-center">Year</th>
                    <th className="py-1 pr-2">Program</th>
                    <th className="py-1 pr-2">Supplier</th>
                    <th className="py-1 px-2 text-right">Unit Cost</th>
                    <th className="py-1 px-2 text-right">Qty</th>
                    <th className="py-1 px-2 text-right">Total</th>
                    <th className="py-1 pl-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-1.5 pr-2 font-medium">{r.title}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.author}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.publisher}</td>
                      <td className="py-1.5 pr-2 text-center text-slate-600">{r.year}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.supplier}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">₱{r.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{r.quantity}</td>
                      <td className="py-1.5 px-2 text-right font-semibold tabular-nums">₱{(r.unit_cost * r.quantity).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 pl-2">
                        <button className="text-red-500 text-[11px] underline" onClick={() => del(r.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 text-xs font-semibold text-psu mt-2 pt-2 border-t border-slate-200">
              <span>{rows.length} titles</span>
              <span>Total: ₱{totalCost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
