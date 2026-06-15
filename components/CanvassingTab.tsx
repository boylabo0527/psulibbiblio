"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { parseSheetRows, isSpreadsheet } from "@/lib/parse-client";
import type { CanvassingRow } from "@/app/api/canvassing/route";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function downloadTemplate(fmt: "xlsx" | "csv") {
  const XLSX = await import("xlsx");
  const headers = ["Title", "Author", "Publisher", "Year", "ISBN", "Supplier", "Price", "Unit", "Quantity", "Stock No", "Notes"];
  const example = ["Introduction to Philosophy", "Popkin, Richard", "Cengage", "2020", "978-0-123456-78-9", "National Book Store", "850.00", "copy", "1", "", ""];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Canvassing");
  const buf = XLSX.write(wb, { type: "buffer", bookType: fmt });
  const blob = new Blob([buf], {
    type: fmt === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `canvassing_template.${fmt}`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
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

const MIGRATION_SQL = `-- Run in Supabase SQL Editor (Project → SQL Editor → New query):
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
  canvass_date date,
  notes text,
  created_at timestamptz default now()
);
alter table canvassing enable row level security;
create policy "service role full access" on canvassing
  using (true) with check (true);`;

export default function CanvassingTab() {
  const [rows, setRows] = useState<CanvassingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  // Upload state
  const [canvassDate, setCanvassDate] = useState(todayStr());
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  function reload() {
    setLoading(true); setErr(null);
    apiFetch("/api/canvassing")
      .then(r => r.json())
      .then(j => {
        if (j.error) {
          const msg: string = j.error;
          if (msg.includes("schema cache") || msg.includes("canvassing") || msg.includes("does not exist") || msg.includes("relation \""))
            setNeedsMigration(true);
          else setErr(msg);
        } else setRows(j.rows ?? []);
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    } finally {
      setParsing(false);
    }
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
      setParsed([]);
      reload();
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
        <h2 className="text-psu font-semibold mb-2">Market Canvassing — Setup Required</h2>
        <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-3">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            The <code>canvassing</code> table does not exist in your Supabase database.
          </p>
          <p className="text-xs text-amber-700">
            Go to your <strong>Supabase project → SQL Editor</strong>, paste the SQL below, and click Run. Then click Retry.
          </p>
        </div>
        <pre className="bg-slate-900 text-green-300 text-xs rounded p-4 overflow-x-auto whitespace-pre-wrap select-all">{MIGRATION_SQL}</pre>
        <div className="flex gap-3 mt-4">
          <button className="btn-outline text-sm" onClick={() => { setNeedsMigration(false); reload(); }}>
            Retry after running migration
          </button>
          <button className="text-sm text-slate-500 underline" onClick={() => navigator.clipboard.writeText(MIGRATION_SQL)}>
            Copy SQL
          </button>
        </div>
      </div>
    );
  }

  // Group by canvass_date for display
  const byDate = rows.reduce<{ date: string; items: CanvassingRow[] }[]>((acc, r) => {
    const d = r.canvass_date || "No date";
    const last = acc[acc.length - 1];
    if (last && last.date === d) last.items.push(r);
    else acc.push({ date: d, items: [r] });
    return acc;
  }, []);

  const totalCost = rows.reduce((s, r) => s + r.unit_cost * r.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Upload Canvassing File</h2>
        <p className="text-xs text-slate-500 mb-1">
          Upload an Excel or CSV of market-canvassed titles. The system will automatically determine
          which programs/subjects each title can help based on procurement gaps — no need to assign a program.
          Expected columns: <span className="font-medium">Title, Author, Publisher, Year, Price, Supplier</span>
          &nbsp;(+ optional: ISBN, Unit, Quantity, Stock No, Notes)
        </p>
        <div className="flex gap-2 mb-4">
          <span className="text-xs text-slate-400">Download template:</span>
          <button className="text-xs text-psu underline" onClick={() => downloadTemplate("xlsx")}>XLSX</button>
          <button className="text-xs text-psu underline" onClick={() => downloadTemplate("csv")}>CSV</button>
        </div>

        <div className="flex flex-wrap gap-3 mb-3">
          <label className="label flex-col items-start gap-1">
            <span>Date of Canvass *</span>
            <input className="input" type="date" value={canvassDate} onChange={e => setCanvassDate(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1">
            <span>Canvassing file</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="text-xs"
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
            <div className="flex gap-2 items-center">
              <button className="btn-outline text-sm" disabled={uploading} onClick={importParsed}>
                {uploading ? "Importing…" : `Import all ${parsed.length} titles (canvassed ${canvassDate || "no date"})`}
              </button>
              <button className="text-sm text-slate-500 hover:text-slate-700" onClick={() => setParsed([])}>Cancel</button>
            </div>
          </>
        )}
      </div>

      {/* Existing entries grouped by date */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-psu font-semibold">Canvassing Entries</h2>
          {rows.length > 0 && (
            <div className="text-xs text-slate-500 font-semibold">
              {rows.length} titles · Total: ₱{totalCost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
            </div>
          )}
        </div>

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-slate-500 text-sm">No entries yet. Upload a canvassing file above.</p>
        )}

        {byDate.map(grp => (
          <div key={grp.date} className="mb-6">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 border-b border-slate-200 pb-1">
              Canvassed: {grp.date === "No date" ? grp.date : new Date(grp.date + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}
              <span className="ml-2 font-normal">({grp.items.length} titles)</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-1 pr-2">Title</th>
                    <th className="py-1 pr-2">Author</th>
                    <th className="py-1 pr-2">Publisher</th>
                    <th className="py-1 pr-2 text-center">Year</th>
                    <th className="py-1 pr-2">Supplier</th>
                    <th className="py-1 px-2 text-right">Unit Cost</th>
                    <th className="py-1 px-2 text-right">Qty</th>
                    <th className="py-1 px-2 text-right">Total</th>
                    <th className="py-1 pl-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {grp.items.map(r => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-1.5 pr-2 font-medium">{r.title}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.author}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.publisher}</td>
                      <td className="py-1.5 pr-2 text-center text-slate-600">{r.year}</td>
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
          </div>
        ))}
      </div>
    </div>
  );
}
