"use client";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import type { CanvassingRow } from "@/app/api/canvassing/route";

type Program = { id: number; name: string };
type Subject = { subject_id: number; course_code: string; course_title: string; program_id: number };

type SelectedItem = {
  row: CanvassingRow;
  quantity: number;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function PurchaseRequestTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filterProgram, setFilterProgram] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [canvassRows, setCanvassRows] = useState<CanvassingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Map<number, SelectedItem>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // PR header form
  const [prNo, setPrNo] = useState("");
  const [date, setDate] = useState(today());
  const [office, setOffice] = useState("");
  const [fundCluster, setFundCluster] = useState("101");
  const [rcCode, setRcCode] = useState("");
  const [purpose, setPurpose] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [approvedBy, setApprovedBy] = useState("University President");

  useEffect(() => {
    apiFetch("/api/programs").then(r => r.json()).then(j => setPrograms(j.programs ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!filterProgram) { setSubjects([]); setFilterSubject(""); return; }
    apiFetch(`/api/dashboard/subjects?program_id=${filterProgram}`)
      .then(r => r.json()).then(j => setSubjects(j.subjects ?? [])).catch(() => {});
    setFilterSubject("");
  }, [filterProgram]);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (filterSubject) p.set("subject_id", filterSubject);
    else if (filterProgram) p.set("program_id", filterProgram);
    apiFetch(`/api/canvassing?${p}`)
      .then(r => r.json())
      .then(j => setCanvassRows(j.rows ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterProgram, filterSubject]);

  function toggleSelect(row: CanvassingRow) {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, { row, quantity: row.quantity });
      return next;
    });
  }

  function setQty(id: number, qty: number) {
    setSelected(prev => {
      const next = new Map(prev);
      const item = next.get(id);
      if (item) next.set(id, { ...item, quantity: Math.max(1, qty) });
      return next;
    });
  }

  function selectAll() {
    setSelected(new Map(canvassRows.map(r => [r.id, { row: r, quantity: r.quantity }])));
  }
  function clearAll() { setSelected(new Map()); }

  const items = useMemo(() => Array.from(selected.values()), [selected]);
  const grandTotal = items.reduce((s, i) => s + i.row.unit_cost * i.quantity, 0);

  async function generate() {
    if (items.length === 0) return;
    setGenerating(true); setErr(null);
    try {
      const body = {
        entityName: "PALAWAN STATE UNIVERSITY",
        office, fundCluster, prNo,
        date: new Date(date).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }),
        rcCode, purpose, requestedBy, approvedBy,
        items: items.map(i => ({
          stock_prop_no: i.row.stock_prop_no,
          unit: i.row.unit,
          description: [i.row.title, i.row.author && `by ${i.row.author}`, i.row.publisher, i.row.year]
            .filter(Boolean).join(", "),
          quantity: i.quantity,
          unit_cost: i.row.unit_cost,
        })),
      };
      const res = await apiFetch("/api/purchase-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setErr(await res.text()); return; }
      const blob = await res.blob();
      const fname = `PR_${(prNo || "draft").replace(/[^A-Za-z0-9_-]/g, "_")}.xlsx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* PR Header */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-4">Purchase Request — Header</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">PR No.</span>
            <input className="input w-full" placeholder="e.g. PR-2025-001" value={prNo} onChange={e => setPrNo(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Date</span>
            <input className="input w-full" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Fund Cluster</span>
            <input className="input w-full" value={fundCluster} onChange={e => setFundCluster(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1 sm:col-span-2">
            <span className="text-xs">Office / Section</span>
            <input className="input w-full" placeholder="e.g. Library Services" value={office} onChange={e => setOffice(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Responsibility Center Code</span>
            <input className="input w-full" value={rcCode} onChange={e => setRcCode(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1 sm:col-span-2">
            <span className="text-xs">Purpose</span>
            <textarea className="input w-full h-16 resize-none" value={purpose} onChange={e => setPurpose(e.target.value)}
              placeholder="e.g. Procurement of library books for accreditation requirements" />
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Requested By</span>
            <input className="input w-full" value={requestedBy} onChange={e => setRequestedBy(e.target.value)} />
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Approved By</span>
            <input className="input w-full" value={approvedBy} onChange={e => setApprovedBy(e.target.value)} />
          </label>
        </div>
      </div>

      {/* Item selection */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-psu font-semibold">Select Items from Canvassing</h2>
          <div className="flex gap-2 text-xs">
            <button className="btn-outline" onClick={selectAll}>Select all</button>
            <button className="btn-outline" onClick={clearAll}>Clear</button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Program
            <select className="input ml-1 min-w-[200px]" value={filterProgram} onChange={e => setFilterProgram(e.target.value)}>
              <option value="">All programs</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {filterProgram && (
            <label className="label">
              Subject
              <select className="input ml-1 min-w-[200px]" value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
                <option value="">All subjects</option>
                {subjects.map(s => <option key={s.subject_id} value={s.subject_id}>{s.course_code} — {s.course_title}</option>)}
              </select>
            </label>
          )}
        </div>

        {loading && <p className="text-slate-500 text-sm">Loading canvassing data…</p>}
        {!loading && canvassRows.length === 0 && (
          <p className="text-slate-500 text-sm">No canvassing entries found. Add entries in the Market Canvassing tab first.</p>
        )}

        {canvassRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2 w-6"></th>
                  <th className="py-1 pr-2">Title / Author</th>
                  <th className="py-1 pr-2">Subject</th>
                  <th className="py-1 pr-2">Supplier</th>
                  <th className="py-1 pr-2">Unit</th>
                  <th className="py-1 px-2 text-right">Unit Cost</th>
                  <th className="py-1 px-2 text-right w-20">Qty</th>
                  <th className="py-1 pl-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {canvassRows.map(r => {
                  const sel = selected.get(r.id);
                  const qty = sel?.quantity ?? r.quantity;
                  return (
                    <tr key={r.id} className={"border-b border-slate-100 " + (sel ? "bg-psu-light" : "hover:bg-slate-50")}>
                      <td className="py-1.5 pr-2">
                        <input type="checkbox" checked={!!sel} onChange={() => toggleSelect(r)} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="font-medium">{r.title}</div>
                        {r.author && <div className="text-slate-500">{r.author}{r.year ? `, ${r.year}` : ""}</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-500">{r.subject_label || r.program}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.supplier}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.unit}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">₱{r.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 px-2 text-right">
                        {sel ? (
                          <input
                            type="number" min="1"
                            className="input w-16 text-right text-xs py-0.5"
                            value={qty}
                            onChange={e => setQty(r.id, Number(e.target.value))}
                          />
                        ) : (
                          <span className="tabular-nums text-slate-500">{r.quantity}</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">
                        {sel ? `₱${(r.unit_cost * qty).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary + Generate */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">Selected items</div>
            <div className="text-2xl font-semibold text-psu">{items.length}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Grand Total</div>
            <div className="text-2xl font-semibold text-psu">
              ₱{grandTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            {err && <p className="text-red-700 text-xs">{err}</p>}
            <button
              className="btn-outline text-sm px-6 py-2 font-semibold"
              disabled={generating || items.length === 0}
              onClick={generate}
            >
              {generating ? "Generating…" : "Generate Purchase Request XLSX"}
            </button>
            {items.length === 0 && <p className="text-xs text-slate-400">Select at least one item above</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
