"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { TorMatchedItem } from "@/app/api/tor/route";

type Options = { suppliers: string[]; programs: string[]; campuses: string[]; fundSources: string[] };

/** Generates a Terms of Reference (.docx) from Purchase Requests already
 *  on file -- filtered by any combination of supplier, campus, program,
 *  and fund source, matching how PSU Library Services' real TORs are
 *  scoped (see lib/exports-tor.ts, built from a sample TOR). This isn't a
 *  fresh title-selection step: it pulls from what's already been
 *  requested, the same relationship /api/purchase-order/consolidated has
 *  to Purchase Requests. */
export default function TorGeneratorTab() {
  const [options, setOptions] = useState<Options>({ suppliers: [], programs: [], campuses: [], fundSources: [] });
  const [supplier, setSupplier] = useState("");
  const [campus, setCampus] = useState("");
  const [program, setProgram] = useState("");
  const [fundSource, setFundSource] = useState("");

  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [matched, setMatched] = useState<TorMatchedItem[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());

  const [projectTitle, setProjectTitle] = useState("Procurement of Textbooks and Other Library Reading Materials");
  const [abc, setAbc] = useState("");
  const [sourceOfFund, setSourceOfFund] = useState("");
  const [proponent, setProponent] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("60");
  const [preparedByName, setPreparedByName] = useState("");
  const [preparedByTitle, setPreparedByTitle] = useState("Director for Library Services");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    apiFetch("/api/tor/options")
      .then((r) => r.json())
      .then((j) => { if (!j.error) setOptions(j); })
      .catch(() => {});
  }, []);

  async function loadItems() {
    setLoading(true); setErr(null); setLoaded(false);
    try {
      const params = new URLSearchParams();
      if (supplier) params.set("supplier", supplier);
      if (campus) params.set("campus", campus);
      if (program) params.set("program", program);
      if (fundSource) params.set("fund_source", fundSource);
      const res = await apiFetch(`/api/tor?${params}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      const items: TorMatchedItem[] = j.items ?? [];
      setMatched(items);
      setIncluded(new Set(items.map((i) => i.key)));
      setAbc(String(j.suggested?.abc ?? 0));
      setSourceOfFund(fundSource || j.suggested?.sourceOfFund || "");
      setProponent(j.suggested?.proponent || "");
      setLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggle(key: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const includedItems = matched.filter((i) => included.has(i.key));
  const includedTotal = includedItems.reduce((s, i) => s + i.quantity * i.unit_cost, 0);

  async function generate() {
    if (includedItems.length === 0) return;
    setGenerating(true); setErr(null);
    try {
      const res = await apiFetch("/api/tor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectTitle, abc: Number(abc) || includedTotal, sourceOfFund, proponent,
          preparedByName, preparedByTitle, deliveryDays,
          items: includedItems.map((i) => ({ particulars: i.particulars, oum: i.oum, quantity: i.quantity })),
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const fname = `TOR_${projectTitle.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}.docx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fname;
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
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Step 1 — Filter</h2>
        <p className="text-xs text-slate-500 mb-4">
          Pulls line items from Purchase Requests already on file, by any combination of supplier, campus, program,
          and fund source. Leave a filter blank to match everything for that axis.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Supplier</span>
            <select className="input w-full" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Any supplier</option>
              {options.suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Campus</span>
            <select className="input w-full" value={campus} onChange={(e) => setCampus(e.target.value)}>
              <option value="">Any campus</option>
              {options.campuses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Program</span>
            <select className="input w-full" value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value="">Any program</option>
              {options.programs.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="label flex-col items-start gap-1">
            <span className="text-xs">Fund Source</span>
            <select className="input w-full" value={fundSource} onChange={(e) => setFundSource(e.target.value)}>
              <option value="">Any fund source</option>
              {options.fundSources.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>
        <button className="btn-outline text-sm" onClick={loadItems} disabled={loading}>
          {loading ? "Loading…" : "Load Matching Items"}
        </button>
        {err && <p className="text-red-700 text-sm mt-2">{err}</p>}
        {loaded && matched.length === 0 && (
          <p className="text-amber-700 text-sm mt-2">No Purchase Request items match this combination of filters.</p>
        )}
      </div>

      {loaded && matched.length > 0 && (
        <>
          <div className="card">
            <h2 className="text-psu font-semibold mb-4">Step 2 — Document Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <label className="label flex-col items-start gap-1 sm:col-span-2 lg:col-span-3">
                <span className="text-xs">Project Title</span>
                <input className="input w-full" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">ABC (PhP)</span>
                <input className="input w-full" type="number" min="0" step="0.01" value={abc} onChange={(e) => setAbc(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Source of Fund</span>
                <input className="input w-full" value={sourceOfFund} onChange={(e) => setSourceOfFund(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Proponent</span>
                <input className="input w-full" value={proponent} onChange={(e) => setProponent(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Delivery (calendar days)</span>
                <input className="input w-full" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Prepared By (name)</span>
                <input className="input w-full" value={preparedByName} onChange={(e) => setPreparedByName(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Prepared By (title)</span>
                <input className="input w-full" value={preparedByTitle} onChange={(e) => setPreparedByTitle(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-psu font-semibold">Step 3 — Items ({includedItems.length} of {matched.length} included)</h2>
              <div className="flex gap-2 text-xs">
                <button className="btn-outline" onClick={() => setIncluded(new Set(matched.map((i) => i.key)))}>Select all</button>
                <button className="btn-outline" onClick={() => setIncluded(new Set())}>Clear all</button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pl-2 w-6"></th>
                    <th className="py-1 px-2">Particulars</th>
                    <th className="py-1 px-2">OUM</th>
                    <th className="py-1 px-2 text-right">Qty</th>
                    <th className="py-1 px-2">Supplier</th>
                    <th className="py-1 px-2">PR No.</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.map((i) => (
                    <tr key={i.key} className={"border-b border-slate-100 " + (included.has(i.key) ? "" : "opacity-40")}>
                      <td className="py-1 pl-2"><input type="checkbox" checked={included.has(i.key)} onChange={() => toggle(i.key)} /></td>
                      <td className="py-1 px-2">{i.particulars}</td>
                      <td className="py-1 px-2 text-slate-500">{i.oum}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="py-1 px-2 text-slate-500">{i.supplier || "—"}</td>
                      <td className="py-1 px-2 text-slate-500">{i.pr_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-6">
                <div>
                  <div className="text-xs text-slate-500">Items included</div>
                  <div className="text-2xl font-semibold text-psu">{includedItems.length}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Total value of included items</div>
                  <div className="text-2xl font-semibold text-psu">₱{includedTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
              <button className="btn-outline text-sm px-6 py-2 font-semibold disabled:opacity-40" disabled={generating || includedItems.length === 0} onClick={generate}>
                {generating ? "Generating…" : "Generate TOR (.docx)"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
