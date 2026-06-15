"use client";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import { PSU_CAMPUSES } from "@/lib/campuses";
import type { CanvassingRow } from "@/app/api/canvassing/route";
import type { ProcurementRow } from "@/app/api/procurement/route";

type Program = { id: number; name: string };

type DraftItem = {
  canvassing_id: number;
  title: string;
  author: string;
  publisher: string;
  year: string;
  supplier: string;
  unit: string;
  stock_prop_no: string;
  unit_cost: number;
  quantity: number;
  subject_label: string; // which subject gap this addresses
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function PurchaseRequestTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [program, setProgram] = useState("");
  const [campus, setCampus] = useState("");
  const [budget, setBudget] = useState("");
  const [procRows, setProcRows] = useState<ProcurementRow[]>([]); // subjects with gaps
  const [canvassRows, setCanvassRows] = useState<CanvassingRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [draft, setDraft] = useState<Map<number, DraftItem>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // PR header
  const [prNo, setPrNo] = useState("");
  const [date, setDate] = useState(today());
  const [office, setOffice] = useState("");
  const [fundCluster, setFundCluster] = useState("101");
  const [rcCode, setRcCode] = useState("");
  const [purpose, setPurpose] = useState("Procurement of library books for accreditation requirements");
  const [requestedBy, setRequestedBy] = useState("");
  const [approvedBy, setApprovedBy] = useState("University President");

  useEffect(() => {
    apiFetch("/api/programs").then(r => r.json())
      .then(j => setPrograms(j.programs ?? [])).catch(() => {});
  }, []);

  async function loadData() {
    if (!program) { setErr("Select a program first."); return; }
    setLoadingData(true); setErr(null); setDraft(new Map()); setDataLoaded(false);
    try {
      const p = new URLSearchParams({ program_id: program });
      if (campus) p.set("campus", campus);
      const [procRes, canvRes] = await Promise.all([
        apiFetch(`/api/procurement?${p}`).then(r => r.json()),
        apiFetch(`/api/canvassing`).then(r => r.json()),  // all canvassing, no program filter
      ]);
      if (procRes.error) throw new Error(procRes.error);
      if (canvRes.error) throw new Error(canvRes.error);

      const gaps: ProcurementRow[] = (procRes.rows ?? []).filter((r: ProcurementRow) => !r.compliant);
      const canvass: CanvassingRow[] = canvRes.rows ?? [];
      setProcRows(gaps);
      setCanvassRows(canvass);

      // Auto-generate draft: for each canvassing title, pre-select it
      // assigned to the subject with the largest gap that isn't yet filled.
      const budgetVal = parseFloat(budget) || Infinity;
      const gapCopy = gaps.map(g => ({ ...g, remaining: g.gap }));
      const initialDraft = new Map<number, DraftItem>();
      let spent = 0;

      // Sort canvassing by unit_cost ascending (maximize coverage within budget)
      const sorted = [...canvass].sort((a, b) => a.unit_cost - b.unit_cost);
      for (const cv of sorted) {
        const itemCost = cv.unit_cost * cv.quantity;
        if (spent + itemCost > budgetVal) continue;
        // Find the gap subject needing the most titles
        const target = gapCopy.filter(g => g.remaining > 0).sort((a, b) => b.remaining - a.remaining)[0];
        const label = target
          ? [target.course_code, target.course_title].filter(Boolean).join(" — ")
          : "";
        if (target) target.remaining = Math.max(0, target.remaining - 1);

        initialDraft.set(cv.id, {
          canvassing_id: cv.id,
          title: cv.title, author: cv.author, publisher: cv.publisher,
          year: cv.year, supplier: cv.supplier, unit: cv.unit,
          stock_prop_no: cv.stock_prop_no,
          unit_cost: cv.unit_cost, quantity: cv.quantity,
          subject_label: label,
        });
        spent += itemCost;
      }
      setDraft(initialDraft);
      setDataLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingData(false);
    }
  }

  function toggleItem(cv: CanvassingRow) {
    setDraft(prev => {
      const next = new Map(prev);
      if (next.has(cv.id)) {
        next.delete(cv.id);
      } else {
        next.set(cv.id, {
          canvassing_id: cv.id,
          title: cv.title, author: cv.author, publisher: cv.publisher,
          year: cv.year, supplier: cv.supplier, unit: cv.unit,
          stock_prop_no: cv.stock_prop_no,
          unit_cost: cv.unit_cost, quantity: cv.quantity,
          subject_label: "",
        });
      }
      return next;
    });
  }

  function setQty(id: number, qty: number) {
    setDraft(prev => {
      const next = new Map(prev);
      const item = next.get(id);
      if (item) next.set(id, { ...item, quantity: Math.max(1, qty) });
      return next;
    });
  }

  const draftItems = useMemo(() => Array.from(draft.values()), [draft]);
  const grandTotal = draftItems.reduce((s, i) => s + i.unit_cost * i.quantity, 0);
  const budgetVal = parseFloat(budget) || 0;
  const overBudget = budgetVal > 0 && grandTotal > budgetVal;
  const remaining = budgetVal > 0 ? budgetVal - grandTotal : null;

  // Gap coverage: how many subjects would be helped by selected items
  const subjectsHelped = new Set(draftItems.map(i => i.subject_label).filter(Boolean)).size;

  async function generate() {
    if (draftItems.length === 0) return;
    setGenerating(true); setErr(null);
    try {
      const body = {
        entityName: "PALAWAN STATE UNIVERSITY",
        office, fundCluster, prNo,
        date: new Date(date).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }),
        rcCode, purpose, requestedBy, approvedBy,
        items: draftItems.map((i, idx) => ({
          stock_prop_no: i.stock_prop_no || String(idx + 1),
          unit: i.unit,
          description: [i.title, i.author && `by ${i.author}`, i.publisher, i.year, i.subject_label && `(${i.subject_label})`]
            .filter(Boolean).join(", "),
          quantity: i.quantity,
          unit_cost: i.unit_cost,
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
      {/* Step 1: Filters + Budget */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-4">Step 1 — Select Program, Campus & Budget</h2>
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Program *
            <select className="input ml-1 min-w-[220px]" value={program} onChange={e => setProgram(e.target.value)}>
              <option value="">— select program —</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="label">
            Campus
            <select className="input ml-1 min-w-[180px]" value={campus} onChange={e => setCampus(e.target.value)}>
              <option value="">All campuses</option>
              {PSU_CAMPUSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="label">
            Available Budget (PHP)
            <input
              className="input ml-1 w-44" type="number" min="0" step="100"
              placeholder="e.g. 50000"
              value={budget} onChange={e => setBudget(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button className="btn-outline text-sm" onClick={loadData} disabled={!program || loadingData}>
              {loadingData ? "Loading…" : "Load Procurement Gaps & Canvassing"}
            </button>
          </div>
        </div>
        {err && <p className="text-red-700 text-sm">{err}</p>}
        {dataLoaded && procRows.length === 0 && (
          <p className="text-green-700 text-sm">All subjects for this program are already compliant — no procurement needed.</p>
        )}
        {dataLoaded && canvassRows.length === 0 && (
          <p className="text-amber-700 text-sm">No canvassing entries found for this program. Upload titles in the Market Canvassing tab first.</p>
        )}
        {dataLoaded && procRows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <div className="text-xs text-red-700">Subjects with gaps</div>
              <div className="text-xl font-semibold text-red-700">{procRows.length}</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <div className="text-xs text-amber-700">Total titles needed</div>
              <div className="text-xl font-semibold text-amber-700">{procRows.reduce((s, r) => s + r.gap, 0)}</div>
            </div>
            <div className="bg-psu-light rounded p-3">
              <div className="text-xs text-slate-600">Canvassed titles</div>
              <div className="text-xl font-semibold text-psu">{canvassRows.length}</div>
            </div>
            <div className="bg-psu-light rounded p-3">
              <div className="text-xs text-slate-600">Auto-selected for PR</div>
              <div className="text-xl font-semibold text-psu">{draft.size}</div>
            </div>
          </div>
        )}
      </div>

      {/* Step 2: PR Header */}
      {dataLoaded && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-4">Step 2 — Purchase Request Header</h2>
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
              <textarea className="input w-full h-16 resize-none" value={purpose} onChange={e => setPurpose(e.target.value)} />
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
      )}

      {/* Step 3: Item selection / draft */}
      {dataLoaded && canvassRows.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h2 className="text-psu font-semibold">Step 3 — Review & Modify Draft PR</h2>
            <div className="flex gap-2 text-xs">
              <button className="btn-outline" onClick={() =>
                setDraft(new Map(canvassRows.map(r => [r.id, {
                  canvassing_id: r.id, title: r.title, author: r.author,
                  publisher: r.publisher, year: r.year, supplier: r.supplier,
                  unit: r.unit, stock_prop_no: r.stock_prop_no,
                  unit_cost: r.unit_cost, quantity: r.quantity, subject_label: "",
                }])))
              }>Select all</button>
              <button className="btn-outline" onClick={() => setDraft(new Map())}>Clear all</button>
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Titles are pre-selected to cover the most subjects with gaps within your budget.
            Check/uncheck to modify. Adjust quantities as needed.
          </p>

          {/* Budget bar */}
          {budgetVal > 0 && (
            <div className="mb-4 p-3 rounded border bg-slate-50 border-slate-200">
              <div className="flex justify-between text-xs mb-1">
                <span className={overBudget ? "text-red-600 font-semibold" : "text-slate-600"}>
                  {overBudget ? "Over budget!" : "Budget usage"}
                </span>
                <span className={overBudget ? "text-red-600 font-semibold" : "text-slate-700"}>
                  ₱{grandTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })} / ₱{budgetVal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                  {remaining !== null && !overBudget && ` (₱${remaining.toLocaleString("en-PH", { minimumFractionDigits: 2 })} remaining)`}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div className="h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (grandTotal / budgetVal) * 100)}%`,
                    backgroundColor: overBudget ? "#dc2626" : grandTotal / budgetVal > 0.9 ? "#d97706" : "#1e40af",
                  }}
                />
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2 w-6"></th>
                  <th className="py-1 pr-2">Title / Author</th>
                  <th className="py-1 pr-2">Subject (gap addressed)</th>
                  <th className="py-1 pr-2">Supplier</th>
                  <th className="py-1 pr-2">Unit</th>
                  <th className="py-1 px-2 text-right">Unit Cost</th>
                  <th className="py-1 px-2 text-right w-20">Qty</th>
                  <th className="py-1 pl-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {canvassRows.map(r => {
                  const sel = draft.get(r.id);
                  const qty = sel?.quantity ?? r.quantity;
                  return (
                    <tr key={r.id} className={"border-b border-slate-100 " + (sel ? "bg-psu-light" : "hover:bg-slate-50")}>
                      <td className="py-1.5 pr-2">
                        <input type="checkbox" checked={!!sel} onChange={() => toggleItem(r)} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="font-medium">{r.title}</div>
                        {r.author && <div className="text-slate-500">{r.author}{r.year ? `, ${r.year}` : ""}</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-500 text-[11px]">
                        {sel?.subject_label || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.supplier}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.unit}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">₱{r.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 px-2">
                        {sel ? (
                          <input type="number" min="1" className="input w-16 text-right text-xs py-0.5"
                            value={qty} onChange={e => setQty(r.id, Number(e.target.value))} />
                        ) : (
                          <span className="text-right block tabular-nums text-slate-400">{r.quantity}</span>
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
        </div>
      )}

      {/* Step 4: Generate */}
      {dataLoaded && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-slate-500">Selected items</div>
                <div className="text-2xl font-semibold text-psu">{draftItems.length}</div>
              </div>
              {subjectsHelped > 0 && (
                <div>
                  <div className="text-xs text-slate-500">Subjects helped</div>
                  <div className="text-2xl font-semibold text-green-700">{subjectsHelped}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-slate-500">Grand Total</div>
                <div className={`text-2xl font-semibold ${overBudget ? "text-red-600" : "text-psu"}`}>
                  ₱{grandTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              {err && <p className="text-red-700 text-xs max-w-xs text-right">{err}</p>}
              {overBudget && <p className="text-red-600 text-xs">Total exceeds budget — uncheck items to reduce.</p>}
              <button
                className="btn-outline text-sm px-6 py-2 font-semibold disabled:opacity-40"
                disabled={generating || draftItems.length === 0 || overBudget}
                onClick={generate}
              >
                {generating ? "Generating…" : "Generate Purchase Request XLSX"}
              </button>
              {draftItems.length === 0 && <p className="text-xs text-slate-400">Select at least one item</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
