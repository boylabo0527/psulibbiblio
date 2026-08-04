"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { groupRows } from "@/lib/group-rows";
import type {
  PurchaseRequestRow, WorkflowStep, SupplierSummaryRow, ProgramSummaryRow, CampusBudgetRow,
} from "@/app/api/monitoring/route";
import type { SupplierOfferRow } from "@/app/api/supplier/offers/route";

type ProposalRow = SupplierOfferRow & { subject_label?: string; program?: string };
type CampusOpt = { id: number; name: string };

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  accepted: "bg-emerald-100 text-emerald-700",
  declined: "bg-red-100 text-red-700",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function yearOf(iso: string): string {
  return String(new Date(iso).getFullYear());
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

/** Admin/role-gated view: Purchase Requests generated (with their current
 *  workflow office and how long they've been there) and supplier proposals
 *  submitted, grouping/filtering for consolidation, per-supplier/per-program
 *  rollups for PO planning, and per-campus budget vs. spent -- read-only
 *  except the workflow-office admin panel, budget editor, and "Advance"
 *  action, each independently gated below. */
export default function MonitoringTab() {
  const { perms } = usePermissions();
  const canEditMonitoring = perms.isAdmin || !!perms.tabs["monitoring"]?.can_edit;

  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequestRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [supplierSummary, setSupplierSummary] = useState<SupplierSummaryRow[]>([]);
  const [programSummary, setProgramSummary] = useState<ProgramSummaryRow[]>([]);
  const [campusBudgets, setCampusBudgets] = useState<CampusBudgetRow[]>([]);
  const [campuses, setCampuses] = useState<CampusOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<number | null>(null);

  const [prGroupBy, setPrGroupBy] = useState<"none" | "campus" | "office" | "year">("none");
  const [propGroupBy, setPropGroupBy] = useState<"none" | "program" | "supplier" | "year">("none");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/monitoring");
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setPurchaseRequests(j.purchaseRequests ?? []);
      setProposals(j.proposals ?? []);
      setWorkflowSteps(j.workflowSteps ?? []);
      setSupplierSummary(j.supplierSummary ?? []);
      setProgramSummary(j.programSummary ?? []);
      setCampusBudgets(j.campusBudgets ?? []);
      setCampuses(j.campuses ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const prGroups = useMemo(() => groupRows(purchaseRequests, prGroupBy, (r) => {
    if (prGroupBy === "campus") return r.campus;
    if (prGroupBy === "year") return yearOf(r.created_at);
    if (prGroupBy === "office") return r.status === "completed" ? "Completed" : (r.current_office || "Not started");
    return "";
  }), [purchaseRequests, prGroupBy]);

  const propGroups = useMemo(() => groupRows(proposals, propGroupBy, (r) => {
    if (propGroupBy === "program") return r.program || "";
    if (propGroupBy === "supplier") return r.supplier_email;
    if (propGroupBy === "year") return yearOf(r.created_at);
    return "";
  }), [proposals, propGroupBy]);

  async function advance(prId: number) {
    setAdvancingId(prId);
    setErr(null);
    try {
      const res = await apiFetch(`/api/purchase-request/${prId}/advance`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdvancingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-red-700 text-sm">{err}</p>}
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}

      {!loading && (
        <>
          {perms.isAdmin && <WorkflowAdmin steps={workflowSteps} onChange={load} />}

          <BudgetByCampus budgets={campusBudgets} campuses={campuses} isAdmin={perms.isAdmin} onChange={load} />

          <div className="card">
            <h2 className="text-psu font-semibold mb-1">Consolidation Summary</h2>
            <p className="text-xs text-slate-500 mb-3">
              Totals across every generated Purchase Request's line items, by supplier and by program --
              use this to decide POs: one PO per supplier for local publishers, and to spot foreign titles
              spread thin across many programs/campuses that no single supplier can cover alone.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="overflow-x-auto">
                <h3 className="text-xs font-semibold text-slate-600 mb-1">By Supplier</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1 pr-2">Supplier</th>
                      <th className="py-1 pr-2 text-right">Items</th>
                      <th className="py-1 pr-2 text-right">Total</th>
                      <th className="py-1 pl-2">Programs / Campuses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplierSummary.map((s) => (
                      <tr key={s.supplier} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 font-medium">{s.supplier}</td>
                        <td className="py-1.5 pr-2 text-right">{s.item_count}</td>
                        <td className="py-1.5 pr-2 text-right">{money(s.total_amount)}</td>
                        <td className="py-1.5 pl-2 text-slate-500">{s.programs.length} program(s) · {s.campuses.length} campus(es)</td>
                      </tr>
                    ))}
                    {supplierSummary.length === 0 && (
                      <tr><td colSpan={4} className="py-2 text-slate-400">No data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto">
                <h3 className="text-xs font-semibold text-slate-600 mb-1">By Program</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1 pr-2">Program</th>
                      <th className="py-1 pr-2 text-right">Items</th>
                      <th className="py-1 pr-2 text-right">Total</th>
                      <th className="py-1 pl-2">Campuses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programSummary.map((p) => (
                      <tr key={p.program} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 font-medium">{p.program}</td>
                        <td className="py-1.5 pr-2 text-right">{p.item_count}</td>
                        <td className="py-1.5 pr-2 text-right">{money(p.total_amount)}</td>
                        <td className="py-1.5 pl-2 text-slate-500">{p.campuses.join(", ")}</td>
                      </tr>
                    ))}
                    {programSummary.length === 0 && (
                      <tr><td colSpan={4} className="py-2 text-slate-400">No data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-psu font-semibold">Purchase Requests Generated</h2>
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Group by:
                <select className="input text-xs py-1" value={prGroupBy} onChange={(e) => setPrGroupBy(e.target.value as typeof prGroupBy)}>
                  <option value="none">None</option>
                  <option value="campus">Campus</option>
                  <option value="office">Current office</option>
                  <option value="year">Year</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Every Purchase Request generated, its current office in the approval workflow, and how long
              it's been there -- flagged if pending 15+ days in the same office.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2">PR No.</th>
                    <th className="py-1 pr-2">Submitted by</th>
                    <th className="py-1 pr-2">Campus</th>
                    <th className="py-1 pr-2 text-right">Items</th>
                    <th className="py-1 pr-2 text-right">Total</th>
                    <th className="py-1 pr-2">Current step</th>
                    <th className="py-1 pl-2">When</th>
                    {canEditMonitoring && <th className="py-1 pl-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {prGroups.flatMap(([label, rows]) => [
                    ...(prGroupBy !== "none" ? [
                      <tr key={`g-${label}`} className="bg-slate-50">
                        <td colSpan={canEditMonitoring ? 8 : 7} className="py-1 px-2 font-semibold text-slate-600">
                          {label} · {rows.length} · ₱{money(rows.reduce((s, r) => s + r.total_amount, 0))}
                        </td>
                      </tr>,
                    ] : []),
                    ...rows.map((pr) => (
                      <tr key={pr.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 whitespace-nowrap">{pr.pr_no || "(draft)"}</td>
                        <td className="py-1.5 pr-2">{pr.submitted_by}</td>
                        <td className="py-1.5 pr-2">{pr.campus || "—"}</td>
                        <td className="py-1.5 pr-2 text-right">{pr.item_count}</td>
                        <td className="py-1.5 pr-2 text-right">{money(pr.total_amount)}</td>
                        <td className="py-1.5 pr-2">
                          {pr.status === "completed" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">Completed</span>
                          ) : pr.current_office ? (
                            <span className={"px-1.5 py-0.5 rounded text-[10px] font-medium " + (pr.overdue ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700")}>
                              {pr.current_office} · {pr.days_in_step}d
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">Not started</span>
                          )}
                        </td>
                        <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(pr.created_at).toLocaleString()}>
                          {formatWhen(pr.created_at)}
                        </td>
                        {canEditMonitoring && (
                          <td className="py-1.5 pl-2 text-right">
                            {pr.status !== "completed" && (
                              <button
                                className="text-psu text-[11px] underline disabled:opacity-40"
                                disabled={advancingId === pr.id}
                                onClick={() => advance(pr.id)}
                              >
                                {advancingId === pr.id ? "…" : "Advance"}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    )),
                  ])}
                  {purchaseRequests.length === 0 && (
                    <tr><td colSpan={canEditMonitoring ? 8 : 7} className="py-3 text-slate-400">No purchase requests generated yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-psu font-semibold">Proposals Submitted</h2>
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Group by:
                <select className="input text-xs py-1" value={propGroupBy} onChange={(e) => setPropGroupBy(e.target.value as typeof propGroupBy)}>
                  <option value="none">None</option>
                  <option value="program">Program</option>
                  <option value="supplier">Supplier</option>
                  <option value="year">Year</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Every supplier offer submitted, most recent first.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2">Supplier</th>
                    <th className="py-1 pr-2">Title</th>
                    <th className="py-1 pr-2">Course</th>
                    <th className="py-1 pr-2">Program</th>
                    <th className="py-1 pr-2 text-right">Price</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pl-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {propGroups.flatMap(([label, rows]) => [
                    ...(propGroupBy !== "none" ? [
                      <tr key={`g-${label}`} className="bg-slate-50">
                        <td colSpan={7} className="py-1 px-2 font-semibold text-slate-600">{label} · {rows.length}</td>
                      </tr>,
                    ] : []),
                    ...rows.map((o) => (
                      <tr key={o.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2">{o.supplier_email}</td>
                        <td className="py-1.5 pr-2 max-w-[220px] truncate" title={o.title}>{o.title}</td>
                        <td className="py-1.5 pr-2">{o.subject_label}</td>
                        <td className="py-1.5 pr-2">{o.program}</td>
                        <td className="py-1.5 pr-2 text-right">{o.price != null ? money(o.price) : ""}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[o.status] ?? "bg-slate-100 text-slate-700"}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(o.created_at).toLocaleString()}>
                          {formatWhen(o.created_at)}
                        </td>
                      </tr>
                    )),
                  ])}
                  {proposals.length === 0 && (
                    <tr><td colSpan={7} className="py-3 text-slate-400">No proposals submitted yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Admin-only panel to configure the ordered list of offices a Purchase
 *  Request passes through -- this is what "current step" / "days pending"
 *  in the tracking table above is measured against. */
function WorkflowAdmin({ steps, onChange }: { steps: WorkflowStep[]; onChange: () => void }) {
  const [newOffice, setNewOffice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function addStep() {
    const name = newOffice.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch("/api/admin/pr-workflow", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ office_name: name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setNewOffice("");
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function rename(id: number) {
    const name = editValue.trim();
    if (!name) { setEditingId(null); return; }
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch("/api/admin/pr-workflow", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, office_name: name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setEditingId(null);
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function move(id: number, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === id);
    const swapWith = steps[idx + dir];
    if (!swapWith) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch("/api/admin/pr-workflow", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, swap_with_id: swapWith.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Remove "${name}" from the PR workflow? Purchase Requests currently at this office will need to be reassigned.`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/admin/pr-workflow?id=${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">Purchase Request Workflow</h2>
      <p className="text-xs text-slate-500 mb-3">
        The ordered offices a Purchase Request passes through, e.g. Library → Budget Office → Accounting →
        President. This is the basis for the "current step" / overdue flag above. Editing this doesn't move
        any in-progress PR -- it only changes what "next" means going forward.
      </p>
      {err && <p className="text-red-700 text-xs mb-2">{err}</p>}
      <ol className="space-y-1 mb-3">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className="text-slate-400 text-xs w-5">{i + 1}.</span>
            {editingId === s.id ? (
              <>
                <input className="input text-xs py-1 flex-1" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                <button className="text-psu text-xs underline" disabled={busy} onClick={() => rename(s.id)}>Save</button>
                <button className="text-slate-400 text-xs underline" onClick={() => setEditingId(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span className="flex-1">{s.office_name}</span>
                <button className="text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={busy || i === 0} onClick={() => move(s.id, -1)} title="Move up">↑</button>
                <button className="text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={busy || i === steps.length - 1} onClick={() => move(s.id, 1)} title="Move down">↓</button>
                <button className="text-psu text-xs underline" onClick={() => { setEditingId(s.id); setEditValue(s.office_name); }}>Rename</button>
                <button className="text-red-600 text-xs underline" disabled={busy} onClick={() => remove(s.id, s.office_name)}>Remove</button>
              </>
            )}
          </li>
        ))}
        {steps.length === 0 && <li className="text-slate-400 text-sm">No offices configured yet -- add the first one below.</li>}
      </ol>
      <div className="flex items-center gap-2">
        <input className="input text-xs" placeholder="e.g. Budget Office" value={newOffice} onChange={(e) => setNewOffice(e.target.value)} />
        <button className="btn-outline text-xs" disabled={busy || !newOffice.trim()} onClick={addStep}>Add office</button>
      </div>
    </div>
  );
}

/** Budget vs. spent per campus/period. Viewable by anyone with Monitoring
 *  access; the inline editor (setting the allocation) is admin-only,
 *  matching /api/admin/campus-budgets. Spent is always computed live from
 *  Purchase Requests, never entered by hand. */
function BudgetByCampus({
  budgets, campuses, isAdmin, onChange,
}: {
  budgets: CampusBudgetRow[]; campuses: CampusOpt[]; isAdmin: boolean; onChange: () => void;
}) {
  const [campusId, setCampusId] = useState("");
  const [period, setPeriod] = useState(String(new Date().getFullYear()));
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!campusId || !period.trim() || amount === "") return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch("/api/admin/campus-budgets", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campus_id: Number(campusId), period: period.trim(), amount: Number(amount) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setCampusId(""); setAmount("");
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">Budget by Campus</h2>
      <p className="text-xs text-slate-500 mb-3">
        Allocated vs. spent (spent = sum of that campus's generated Purchase Requests in the period). Flags
        which campuses are over so the excess from an under-budget campus can be considered for
        reallocation -- moving funds itself is still a manual/offline decision, this just surfaces the numbers.
      </p>
      {err && <p className="text-red-700 text-xs mb-2">{err}</p>}
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1 pr-2">Campus</th>
              <th className="py-1 pr-2">Period</th>
              <th className="py-1 pr-2 text-right">Budget</th>
              <th className="py-1 pr-2 text-right">Spent</th>
              <th className="py-1 pl-2 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((b) => (
              <tr key={`${b.campus_id}-${b.period}`} className="border-b border-slate-100">
                <td className="py-1.5 pr-2 font-medium">{b.campus_name}</td>
                <td className="py-1.5 pr-2">{b.period}</td>
                <td className="py-1.5 pr-2 text-right">{money(b.amount)}</td>
                <td className="py-1.5 pr-2 text-right">{money(b.spent)}</td>
                <td className="py-1.5 pl-2 text-right">
                  <span className={b.over ? "text-red-600 font-semibold" : "text-emerald-700"}>
                    {b.over ? `Over by ${money(Math.abs(b.remaining))}` : money(b.remaining)}
                  </span>
                </td>
              </tr>
            ))}
            {budgets.length === 0 && (
              <tr><td colSpan={5} className="py-2 text-slate-400">No campus budgets set yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
          <select className="input text-xs" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
            <option value="">Select campus</option>
            {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="input text-xs w-24" placeholder="Period (e.g. 2026)" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <input className="input text-xs w-32" type="number" min="0" step="100" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn-outline text-xs" disabled={busy || !campusId || !period.trim() || amount === ""} onClick={save}>
            {busy ? "Saving…" : "Set budget"}
          </button>
        </div>
      )}
    </div>
  );
}
