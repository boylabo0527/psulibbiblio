"use client";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import { useCampuses, useProgramCampusMap } from "@/lib/use-campuses";
import type { CanvassingRow } from "@/app/api/canvassing/route";

type Program = { id: number; name: string };

type DraftItem = CanvassingRow & { selected: boolean; draftQty: number };

function today() { return new Date().toISOString().slice(0, 10); }

export default function PurchaseRequestTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<Set<number>>(new Set());
  const [campus, setCampus] = useState("");
  const [budget, setBudget] = useState("");
  const [allMatched, setAllMatched] = useState<CanvassingRow[]>([]);
  const [draft, setDraft] = useState<Map<number, DraftItem>>(new Map());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const campuses = useCampuses();
  const { isProgramAtCampus } = useProgramCampusMap();

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
      .then(j => {
        const list: Program[] = j.programs ?? [];
        setPrograms(list);
      }).catch(() => {});
  }, []);

  function toggleProgram(id: number) {
    setSelectedPrograms(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function loadItems() {
    if (selectedPrograms.size === 0) { setErr("Select at least one program."); return; }
    setLoading(true); setErr(null); setLoaded(false);
    try {
      // Fetch all matched canvassing entries (subject_id assigned)
      const res = await apiFetch("/api/canvassing").then(r => r.json());
      if (res.error) throw new Error(res.error);
      const all: CanvassingRow[] = res.rows ?? [];
      // Filter: must have a subject assigned and belong to selected programs
      const matched = all.filter(r =>
        r.subject_id !== null &&
        r.program_id !== null &&
        selectedPrograms.has(r.program_id)
      );
      setAllMatched(matched);
      // Initialize draft with all matched items selected
      const initDraft = new Map<number, DraftItem>();
      for (const r of matched) {
        initDraft.set(r.id, { ...r, selected: true, draftQty: r.quantity });
      }
      setDraft(initDraft);
      setLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  function toggleItem(id: number) {
    setDraft(prev => {
      const next = new Map(prev);
      const item = next.get(id);
      if (item) next.set(id, { ...item, selected: !item.selected });
      return next;
    });
  }

  function setQty(id: number, qty: number) {
    setDraft(prev => {
      const next = new Map(prev);
      const item = next.get(id);
      if (item) next.set(id, { ...item, draftQty: Math.max(1, qty) });
      return next;
    });
  }

  const selectedItems = useMemo(() => Array.from(draft.values()).filter(i => i.selected), [draft]);
  const grandTotal = selectedItems.reduce((s, i) => s + i.unit_cost * i.draftQty, 0);
  const budgetVal = parseFloat(budget) || 0;
  const overBudget = budgetVal > 0 && grandTotal > budgetVal;

  // Group selected items by program → subject
  const grouped = useMemo(() => {
    const byProg = new Map<string, { program_id: number; subjects: Map<string, { label: string; items: DraftItem[] }> }>();
    for (const item of selectedItems) {
      if (!byProg.has(item.program)) byProg.set(item.program, { program_id: item.program_id!, subjects: new Map() });
      const subjKey = item.subject_label || "General";
      const prog = byProg.get(item.program)!;
      if (!prog.subjects.has(subjKey)) prog.subjects.set(subjKey, { label: subjKey, items: [] });
      prog.subjects.get(subjKey)!.items.push(item);
    }
    return Array.from(byProg.entries());
  }, [selectedItems]);

  async function generate() {
    if (selectedItems.length === 0) return;
    setGenerating(true); setErr(null);
    try {
      const campusId = campus ? campuses.find(c => c.name === campus)?.id ?? null : null;
      const body = {
        entityName: "PALAWAN STATE UNIVERSITY",
        office, fundCluster, prNo,
        date: new Date(date + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }),
        rcCode, purpose, requestedBy, approvedBy,
        campus, campus_id: campusId,
        items: selectedItems.map((i, idx) => ({
          stock_prop_no: i.stock_prop_no || String(idx + 1),
          unit: i.unit,
          description: [
            i.title,
            i.author && `by ${i.author}`,
            i.publisher,
            i.year,
            i.subject_label && `[${i.subject_label}]`,
            i.program && `(${i.program})`,
          ].filter(Boolean).join(", "),
          quantity: i.draftQty,
          unit_cost: i.unit_cost,
          supplier: i.supplier || "",
          program: i.program || "",
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
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setGenerating(false); }
  }

  return (
    <div className="space-y-4">
      {/* Step 1: Select programs + campus + budget */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Step 1 — Select Programs & Budget</h2>
        <p className="text-xs text-slate-500 mb-4">
          Select one or more programs to consolidate into a single Purchase Request.
          Only titles already matched to subject gaps in the Canvassing tab will appear.
        </p>

        <div className="mb-3">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-medium text-slate-600">Programs (select one or more):</span>
            {campus && (
              <button className="text-xs text-psu underline" onClick={() => {
                const atCampus = programs.filter(p => isProgramAtCampus(p.id, campus));
                setSelectedPrograms(new Set(atCampus.map(p => p.id)));
              }}>
                Select all {campus} programs
              </button>
            )}
            {!campus && (
              <button className="text-xs text-psu underline" onClick={() =>
                setSelectedPrograms(new Set(programs.map(p => p.id)))
              }>Select all</button>
            )}
            {selectedPrograms.size > 0 && (
              <button className="text-xs text-slate-400 underline" onClick={() => setSelectedPrograms(new Set())}>Clear</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(campus ? programs.filter(p => isProgramAtCampus(p.id, campus)) : programs).map(p => (
              <label key={p.id} className={
                "flex items-center gap-1.5 cursor-pointer rounded border px-3 py-1.5 text-xs transition " +
                (selectedPrograms.has(p.id)
                  ? "bg-psu text-white border-psu"
                  : "border-slate-300 text-slate-600 hover:border-psu hover:text-psu")
              }>
                <input type="checkbox" className="hidden" checked={selectedPrograms.has(p.id)} onChange={() => toggleProgram(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Campus
            <select className="input ml-1 min-w-[180px]" value={campus} onChange={e => {
              const c = e.target.value;
              setCampus(c);
              // Remove selected programs not offered at this campus
              if (c) setSelectedPrograms(prev => {
                const next = new Set(prev);
                programs.forEach(p => { if (next.has(p.id) && !isProgramAtCampus(p.id, c)) next.delete(p.id); });
                return next;
              });
            }}>
              <option value="">All campuses</option>
              {campuses.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="label">
            Available Budget (PHP)
            <input className="input ml-1 w-44" type="number" min="0" step="100"
              placeholder="e.g. 50000" value={budget} onChange={e => setBudget(e.target.value)} />
          </label>
          <div className="flex items-end">
            <button className="btn-outline text-sm" onClick={loadItems} disabled={loading || selectedPrograms.size === 0}>
              {loading ? "Loading…" : "Load Matched Titles"}
            </button>
          </div>
        </div>
        {err && <p className="text-red-700 text-sm">{err}</p>}
        {loaded && allMatched.length === 0 && (
          <p className="text-amber-700 text-sm">
            No matched titles found for the selected program(s). Go to the Market Canvassing tab to assign canvassed titles to subject gaps first.
          </p>
        )}
      </div>

      {/* Step 2: PR Header */}
      {loaded && allMatched.length > 0 && (
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

      {/* Step 3: Review items grouped by program → subject */}
      {loaded && allMatched.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-psu font-semibold">Step 3 — Review & Finalize Items</h2>
            <div className="flex gap-2 text-xs">
              <button className="btn-outline" onClick={() => setDraft(prev => {
                const next = new Map(prev);
                next.forEach((v, k) => next.set(k, { ...v, selected: true }));
                return next;
              })}>Select all</button>
              <button className="btn-outline" onClick={() => setDraft(prev => {
                const next = new Map(prev);
                next.forEach((v, k) => next.set(k, { ...v, selected: false }));
                return next;
              })}>Clear all</button>
            </div>
          </div>

          {/* Budget bar */}
          {budgetVal > 0 && (
            <div className="mb-4 p-3 rounded border bg-slate-50 border-slate-200">
              <div className="flex justify-between text-xs mb-1">
                <span className={overBudget ? "text-red-600 font-semibold" : "text-slate-600"}>
                  {overBudget ? "Over budget!" : "Budget usage"}
                </span>
                <span className={overBudget ? "text-red-600 font-semibold" : "text-slate-700"}>
                  ₱{grandTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })} / ₱{budgetVal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                  {!overBudget && <span className="ml-1 text-slate-500">(₱{(budgetVal - grandTotal).toLocaleString("en-PH", { minimumFractionDigits: 2 })} remaining)</span>}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div className="h-2 rounded-full transition-all" style={{
                  width: `${Math.min(100, (grandTotal / budgetVal) * 100)}%`,
                  backgroundColor: overBudget ? "#dc2626" : grandTotal / budgetVal > 0.9 ? "#d97706" : "#1e40af",
                }} />
              </div>
            </div>
          )}

          {/* Grouped by program → subject */}
          {grouped.map(([progName, { subjects }]) => (
            <div key={progName} className="mb-6">
              <h3 className="text-sm font-semibold text-psu mb-2 pb-1 border-b border-slate-200">{progName}</h3>
              {Array.from(subjects.entries()).map(([subjKey, { label, items }]) => (
                <div key={subjKey} className="mb-3 ml-2">
                  <div className="text-xs font-medium text-slate-600 mb-1">{label}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 text-left">
                        <th className="py-0.5 pr-2 w-6"></th>
                        <th className="py-0.5 pr-2">Title</th>
                        <th className="py-0.5 pr-2">Author</th>
                        <th className="py-0.5 pr-2">Supplier</th>
                        <th className="py-0.5 px-2 text-right">Unit Cost</th>
                        <th className="py-0.5 px-2 w-20 text-right">Qty</th>
                        <th className="py-0.5 pl-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id} className={"border-b border-slate-100 " + (item.selected ? "bg-psu-light" : "opacity-50")}>
                          <td className="py-1 pr-2">
                            <input type="checkbox" checked={item.selected} onChange={() => toggleItem(item.id)} />
                          </td>
                          <td className="py-1 pr-2 font-medium">{item.title}{item.year ? ` (${item.year})` : ""}</td>
                          <td className="py-1 pr-2 text-slate-600">{item.author}</td>
                          <td className="py-1 pr-2 text-slate-600">{item.supplier}</td>
                          <td className="py-1 px-2 text-right tabular-nums">₱{item.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                          <td className="py-1 px-2">
                            {item.selected ? (
                              <input type="number" min="1" className="input w-14 text-right text-xs py-0.5"
                                value={item.draftQty} onChange={e => setQty(item.id, Number(e.target.value))} />
                            ) : (
                              <span className="text-right block tabular-nums text-slate-400">{item.draftQty}</span>
                            )}
                          </td>
                          <td className="py-1 pl-2 text-right font-semibold tabular-nums">
                            {item.selected ? `₱${(item.unit_cost * item.draftQty).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Step 4: Generate */}
      {loaded && allMatched.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-slate-500">Selected items</div>
                <div className="text-2xl font-semibold text-psu">{selectedItems.length}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Grand Total</div>
                <div className={`text-2xl font-semibold ${overBudget ? "text-red-600" : "text-psu"}`}>
                  ₱{grandTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {err && <p className="text-red-700 text-xs max-w-xs text-right">{err}</p>}
              {overBudget && <p className="text-red-600 text-xs">Total exceeds budget — uncheck items to reduce.</p>}
              <button
                className="btn-outline text-sm px-6 py-2 font-semibold disabled:opacity-40"
                disabled={generating || selectedItems.length === 0 || overBudget}
                onClick={generate}
              >
                {generating ? "Generating…" : "Generate Purchase Request XLSX"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
