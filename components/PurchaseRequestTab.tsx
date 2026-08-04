"use client";
import { useEffect, useState, useMemo } from "react";
import { apiFetch } from "@/lib/api-client";
import { useCampuses } from "@/lib/use-campuses";
import { isPriceStale, daysSincePriced } from "@/lib/pricing";
import type { CanvassingRow } from "@/app/api/canvassing/route";

type DraftItem = CanvassingRow & { selected: boolean; draftQty: number };

function today() { return new Date().toISOString().slice(0, 10); }

export default function PurchaseRequestTab() {
  const [campus, setCampus] = useState("");
  const [budget, setBudget] = useState("");
  const [allMatched, setAllMatched] = useState<CanvassingRow[]>([]);
  const [draft, setDraft] = useState<Map<number, DraftItem>>(new Map());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [excludedCount, setExcludedCount] = useState(0);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [itemSortBy, setItemSortBy] = useState<"none" | "price_asc" | "price_desc" | "title_asc">("none");
  const campuses = useCampuses();

  // PR header
  const [prNo, setPrNo] = useState("");
  const [date, setDate] = useState(today());
  const [office, setOffice] = useState("");
  const [fundCluster, setFundCluster] = useState("101");
  const [rcCode, setRcCode] = useState("");
  const [purpose, setPurpose] = useState("Procurement of library books for accreditation requirements");
  const [requestedBy, setRequestedBy] = useState("");
  const [approvedBy, setApprovedBy] = useState("University President");

  async function loadItems() {
    setLoading(true); setErr(null); setLoaded(false);
    try {
      // Fetch all matched canvassing entries (subject_id assigned), and
      // which of them are already claimed by another active purchase
      // request -- excluded below so the same title can't be requested
      // twice while its first request is still pending/in-progress. Not
      // filtered by program -- a title can now be linked to courses across
      // more than one program, so gating by program either hid it from a
      // program where it also applies, or required loading multiple times.
      // Campus is this PR's own record (for budget attribution), not a
      // filter over which titles are eligible.
      const [res, claimedRes] = await Promise.all([
        apiFetch("/api/canvassing").then(r => r.json()),
        apiFetch("/api/purchase-request/requested-ids").then(r => r.json()).catch(() => ({ claimed: [] })),
      ]);
      if (res.error) throw new Error(res.error);
      const all: CanvassingRow[] = res.rows ?? [];
      const claimedIds = new Set<number>((claimedRes.claimed ?? []).map((c: { canvassing_id: number }) => c.canvassing_id));
      const eligible = all.filter(r => r.subject_id !== null);
      const matched = eligible.filter(r => !claimedIds.has(r.id));
      setExcludedCount(eligible.length - matched.length);
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

  const supplierOptions = useMemo(() => Array.from(new Set(Array.from(draft.values()).map(i => i.supplier).filter(Boolean))).sort(), [draft]);

  /** Every course a title counts toward, for display -- a title can now be
   *  linked to more than one course/program (see canvassing_subjects), so
   *  this is a list, not a single label. */
  function courseTags(item: DraftItem): string[] {
    const tags = [item.subject_label, ...item.additional_subjects.map(a => [a.course_code, a.course_title].filter(Boolean).join(" — "))];
    return tags.filter(Boolean);
  }

  // Group selected items by supplier -- suppliers are the actual
  // procurement-relevant grouping (one PO per supplier downstream), and
  // unlike program, every item has exactly one. Program filtering isn't
  // used here anymore: a title can now be linked to courses across more
  // than one program, so gating by program either hid it from a program it
  // also applies to, or forced loading the same title's PR more than once.
  const grouped = useMemo(() => {
    let list = selectedItems;
    if (supplierFilter) list = list.filter(i => i.supplier === supplierFilter);
    const sorted = [...list];
    if (itemSortBy === "price_asc") sorted.sort((a, b) => a.unit_cost - b.unit_cost);
    else if (itemSortBy === "price_desc") sorted.sort((a, b) => b.unit_cost - a.unit_cost);
    else if (itemSortBy === "title_asc") sorted.sort((a, b) => a.title.localeCompare(b.title));

    const bySupplier = new Map<string, DraftItem[]>();
    for (const item of sorted) {
      const key = item.supplier || "Unspecified";
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key)!.push(item);
    }
    return Array.from(bySupplier.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectedItems, supplierFilter, itemSortBy]);

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
            courseTags(i).length > 0 && `[${courseTags(i).join("; ")}]`,
          ].filter(Boolean).join(", "),
          quantity: i.draftQty,
          unit_cost: i.unit_cost,
          supplier: i.supplier || "",
          program: i.program || "",
          canvassing_id: i.id,
          priced_at: i.canvass_date || i.created_at,
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
      {/* Step 1: Campus + budget */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Step 1 — Campus &amp; Budget</h2>
        <p className="text-xs text-slate-500 mb-4">
          Every title already matched to a subject gap in Market Canvassing loads below, organized by supplier --
          not filtered by program, since a single title can now count toward courses in more than one program.
          Campus is this request's own record (for budget tracking), not a filter on which titles appear.
        </p>

        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Campus
            <select className="input ml-1 min-w-[180px]" value={campus} onChange={e => setCampus(e.target.value)}>
              <option value="">All campuses / not campus-specific</option>
              {campuses.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="label">
            Available Budget (PHP)
            <input className="input ml-1 w-44" type="number" min="0" step="100"
              placeholder="e.g. 50000" value={budget} onChange={e => setBudget(e.target.value)} />
          </label>
          <div className="flex items-end">
            <button className="btn-outline text-sm" onClick={loadItems} disabled={loading}>
              {loading ? "Loading…" : "Load Matched Titles"}
            </button>
          </div>
        </div>
        {err && <p className="text-red-700 text-sm">{err}</p>}
        {loaded && allMatched.length === 0 && (
          <p className="text-amber-700 text-sm">
            No matched titles found. Go to the Market Canvassing tab to assign canvassed titles to subject gaps first.
          </p>
        )}
        {loaded && excludedCount > 0 && (
          <p className="text-slate-500 text-xs mt-1">
            {excludedCount} matched title{excludedCount === 1 ? "" : "s"} excluded -- already on another active purchase request.
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

      {/* Step 3: Review items grouped by supplier */}
      {loaded && allMatched.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-psu font-semibold">Step 3 — Review & Finalize Items</h2>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="text-slate-500 flex items-center gap-1.5">
                Supplier:
                <select className="input text-xs py-1" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                  <option value="">All suppliers</option>
                  {supplierOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-slate-500 flex items-center gap-1.5">
                Sort:
                <select className="input text-xs py-1" value={itemSortBy} onChange={e => setItemSortBy(e.target.value as typeof itemSortBy)}>
                  <option value="none">Default</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="title_asc">Title A-Z</option>
                </select>
              </label>
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

          {/* Grouped by supplier */}
          {grouped.map(([supplierName, items]) => (
            <div key={supplierName} className="mb-6">
              <h3 className="text-sm font-semibold text-psu mb-2 pb-1 border-b border-slate-200">
                {supplierName} · {items.length} · ₱{items.reduce((s, i) => s + i.unit_cost * i.draftQty, 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left">
                    <th className="py-0.5 pr-2 w-6"></th>
                    <th className="py-0.5 pr-2">Title</th>
                    <th className="py-0.5 pr-2">Author</th>
                    <th className="py-0.5 pr-2">Course(s)</th>
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
                      <td className="py-1 pr-2 text-slate-500">{courseTags(item).join("; ") || "—"}</td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        ₱{item.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                        {isPriceStale(item.canvass_date || item.created_at) && (
                          <span className="ml-1 text-amber-600" title={`Quoted ${daysSincePriced(item.canvass_date || item.created_at)} days ago -- verify with supplier before ordering`}>⚠</span>
                        )}
                      </td>
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
