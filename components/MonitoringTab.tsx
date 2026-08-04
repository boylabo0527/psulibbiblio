"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { groupRows } from "@/lib/group-rows";
import { isPriceStale, daysSincePriced, PRICE_VALIDITY_DAYS } from "@/lib/pricing";
import type {
  PurchaseRequestRow, WorkflowStep, SupplierSummaryRow, ProgramSummaryRow, CampusBudgetRow, PurchaseOrderRow,
} from "@/app/api/monitoring/route";
import type { SupplierOfferRow } from "@/app/api/supplier/offers/route";
import type { PersistedPRItem } from "@/lib/purchase-request-items";

type ProposalRow = SupplierOfferRow & { subject_label?: string; program?: string };
type CampusOpt = { id: number; name: string };

type FullPurchaseRequest = {
  id: number; pr_no: string; office: string; purpose: string; requested_by: string; approved_by: string;
  items: PersistedPRItem[]; total_amount: number; status: string;
};

type FullPurchaseOrder = {
  id: number; po_no: string; address: string; tin: string; mode_of_procurement: string;
  place_of_delivery: string; delivery_term: string; date_of_delivery: string; payment_term: string;
  fund_cluster: string; ors_burs_no: string; date_of_ors_burs: string;
  items: { stock_prop_no: string; unit: string; description: string; quantity: number; unit_cost: number }[];
  total_amount: number; status: string;
};

/** Sentinel campus_id select value for the "University-wide / Digital"
 *  budget line (real campus_id is null server-side) -- <select> can't hold
 *  a null value, so this string stands in for it in the DOM. */
const UNIVERSITY_WIDE = "__university_wide__";

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
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([]);
  const [campuses, setCampuses] = useState<CampusOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);
  const [editingPrId, setEditingPrId] = useState<number | null>(null);
  const [poForSupplier, setPoForSupplier] = useState<string | null>(null);
  const [editingPoId, setEditingPoId] = useState<number | null>(null);
  const [poBusyId, setPoBusyId] = useState<number | null>(null);
  const [poStatusFilter, setPoStatusFilter] = useState<"all" | "active" | "cancelled">("all");
  const [poSortBy, setPoSortBy] = useState<"date_desc" | "date_asc" | "total_desc" | "total_asc">("date_desc");
  const [poGroupBy, setPoGroupBy] = useState<"none" | "supplier" | "year">("none");

  const [prGroupBy, setPrGroupBy] = useState<"none" | "campus" | "office" | "year">("none");
  const [prStatusFilter, setPrStatusFilter] = useState<"all" | "active" | "cancelled">("active");
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
      setPurchaseOrders(j.purchaseOrders ?? []);
      setCampuses(j.campuses ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const prGroups = useMemo(() => {
    const filtered = prStatusFilter === "all" ? purchaseRequests
      : prStatusFilter === "cancelled" ? purchaseRequests.filter((r) => r.status === "cancelled")
      : purchaseRequests.filter((r) => r.status !== "cancelled");
    return groupRows(filtered, prGroupBy, (r) => {
      if (prGroupBy === "campus") return r.campus;
      if (prGroupBy === "year") return yearOf(r.created_at);
      if (prGroupBy === "office") return r.status === "completed" ? "Completed" : (r.current_office || "Not started");
      return "";
    });
  }, [purchaseRequests, prGroupBy, prStatusFilter]);

  const propGroups = useMemo(() => groupRows(proposals, propGroupBy, (r) => {
    if (propGroupBy === "program") return r.program || "";
    if (propGroupBy === "supplier") return r.supplier_email;
    if (propGroupBy === "year") return yearOf(r.created_at);
    return "";
  }), [proposals, propGroupBy]);

  const poGroups = useMemo(() => {
    const filtered = poStatusFilter === "all" ? purchaseOrders : purchaseOrders.filter((po) => po.status === poStatusFilter);
    const sorted = [...filtered].sort((a, b) => {
      if (poSortBy === "date_desc") return b.created_at.localeCompare(a.created_at);
      if (poSortBy === "date_asc") return a.created_at.localeCompare(b.created_at);
      if (poSortBy === "total_desc") return b.total_amount - a.total_amount;
      return a.total_amount - b.total_amount;
    });
    return groupRows(sorted, poGroupBy, (po) => {
      if (poGroupBy === "supplier") return po.supplier;
      if (poGroupBy === "year") return yearOf(po.created_at);
      return "";
    });
  }, [purchaseOrders, poStatusFilter, poSortBy, poGroupBy]);

  async function setPrStatus(prId: number, body: { current_step_seq: number } | { status: "completed" }) {
    setStatusBusyId(prId);
    setErr(null);
    try {
      const res = await apiFetch(`/api/purchase-request/${prId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusyId(null);
    }
  }

  async function cancelPr(pr: PurchaseRequestRow) {
    if (!confirm(`Cancel purchase request ${pr.pr_no || "(draft)"}? Its titles become available to request again. This can't be undone.`)) return;
    setStatusBusyId(pr.id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/purchase-request/${pr.id}/cancel`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusyId(null);
    }
  }

  async function deletePr(pr: PurchaseRequestRow) {
    if (!confirm(`Permanently delete cancelled purchase request ${pr.pr_no || "(draft)"}? This can't be undone.`)) return;
    setStatusBusyId(pr.id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/purchase-request/${pr.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusyId(null);
    }
  }

  async function cancelPo(po: PurchaseOrderRow) {
    if (!confirm(`Cancel purchase order ${po.po_no || "(draft)"}? Its titles become available for a future PO. This can't be undone.`)) return;
    setPoBusyId(po.id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/purchase-order/${po.id}/cancel`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPoBusyId(null);
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
                      {canEditMonitoring && <th className="py-1 pl-2"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {supplierSummary.map((s) => (
                      <tr key={s.supplier} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 font-medium">{s.supplier}</td>
                        <td className="py-1.5 pr-2 text-right">{s.item_count}</td>
                        <td className="py-1.5 pr-2 text-right">{money(s.total_amount)}</td>
                        <td className="py-1.5 pl-2 text-slate-500">{s.programs.length} program(s) · {s.campuses.length} campus(es)</td>
                        {canEditMonitoring && (
                          <td className="py-1.5 pl-2 text-right">
                            {s.supplier !== "Unspecified" && (
                              <button className="text-psu text-[11px] underline" onClick={() => setPoForSupplier(s.supplier)}>Generate PO</button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {supplierSummary.length === 0 && (
                      <tr><td colSpan={canEditMonitoring ? 5 : 4} className="py-2 text-slate-400">No data yet.</td></tr>
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

          {poForSupplier != null && (
            <GeneratePoPanel
              supplier={poForSupplier}
              onClose={() => setPoForSupplier(null)}
              onGenerated={() => { setPoForSupplier(null); load(); }}
            />
          )}

          {editingPoId != null && (
            <PurchaseOrderEditPanel
              poId={editingPoId}
              onClose={() => setEditingPoId(null)}
              onSaved={() => { setEditingPoId(null); load(); }}
            />
          )}

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
              <h2 className="text-psu font-semibold">Purchase Orders Generated</h2>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-slate-500 flex items-center gap-1.5">
                  Status:
                  <select className="input text-xs py-1" value={poStatusFilter} onChange={(e) => setPoStatusFilter(e.target.value as typeof poStatusFilter)}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500 flex items-center gap-1.5">
                  Sort by:
                  <select className="input text-xs py-1" value={poSortBy} onChange={(e) => setPoSortBy(e.target.value as typeof poSortBy)}>
                    <option value="date_desc">Newest first</option>
                    <option value="date_asc">Oldest first</option>
                    <option value="total_desc">Total: High to Low</option>
                    <option value="total_asc">Total: Low to High</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500 flex items-center gap-1.5">
                  Group by:
                  <select className="input text-xs py-1" value={poGroupBy} onChange={(e) => setPoGroupBy(e.target.value as typeof poGroupBy)}>
                    <option value="none">None</option>
                    <option value="supplier">Supplier</option>
                    <option value="year">Year</option>
                  </select>
                </label>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-3">Every Purchase Order generated from supplier consolidation.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2">PO No.</th>
                    <th className="py-1 pr-2">Supplier</th>
                    <th className="py-1 pr-2 text-right">Items</th>
                    <th className="py-1 pr-2 text-right">Total</th>
                    <th className="py-1 pr-2">Generated by</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pl-2">When</th>
                    {canEditMonitoring && <th className="py-1 pl-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {poGroups.flatMap(([label, poRows]) => [
                    ...(poGroupBy !== "none" ? [
                      <tr key={`g-${label}`} className="bg-slate-50">
                        <td colSpan={canEditMonitoring ? 8 : 7} className="py-1 px-2 font-semibold text-slate-600">
                          {label} · {poRows.length} · ₱{money(poRows.reduce((s, r) => s + r.total_amount, 0))}
                        </td>
                      </tr>,
                    ] : []),
                    ...poRows.map((po) => (
                      <tr key={po.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 whitespace-nowrap">{po.po_no || "(draft)"}</td>
                        <td className="py-1.5 pr-2">{po.supplier}</td>
                        <td className="py-1.5 pr-2 text-right">{po.item_count}</td>
                        <td className="py-1.5 pr-2 text-right">{money(po.total_amount)}</td>
                        <td className="py-1.5 pr-2">{po.generated_by}</td>
                        <td className="py-1.5 pr-2">
                          {po.status === "cancelled" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600">Cancelled</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">Active</span>
                          )}
                        </td>
                        <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(po.created_at).toLocaleString()}>
                          {formatWhen(po.created_at)}
                        </td>
                        {canEditMonitoring && (
                          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                            {po.status === "active" && (
                              <>
                                <button className="text-psu text-[11px] underline mr-2" onClick={() => setEditingPoId(po.id)}>Edit</button>
                                <button
                                  className="text-red-600 text-[11px] underline disabled:opacity-40"
                                  disabled={poBusyId === po.id}
                                  onClick={() => cancelPo(po)}
                                >
                                  Cancel
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    )),
                  ])}
                  {purchaseOrders.length === 0 && (
                    <tr><td colSpan={canEditMonitoring ? 8 : 7} className="py-3 text-slate-400">No purchase orders generated yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-psu font-semibold">Purchase Requests Generated</h2>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-500 flex items-center gap-1.5">
                  Status:
                  <select className="input text-xs py-1" value={prStatusFilter} onChange={(e) => setPrStatusFilter(e.target.value as typeof prStatusFilter)}>
                    <option value="active">Active &amp; completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="all">All</option>
                  </select>
                </label>
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
                          {pr.status === "cancelled" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600">Cancelled</span>
                          ) : canEditMonitoring ? (
                            <select
                              className={"input text-[11px] py-0.5 " + (pr.overdue ? "border-red-400 text-red-700" : "")}
                              disabled={statusBusyId === pr.id}
                              value={pr.status === "completed" ? "completed" : (pr.current_step_seq ?? "")}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "completed") setPrStatus(pr.id, { status: "completed" });
                                else if (v) setPrStatus(pr.id, { current_step_seq: Number(v) });
                              }}
                            >
                              <option value="" disabled>Not started</option>
                              {workflowSteps.map((s) => <option key={s.id} value={s.seq}>{s.office_name}</option>)}
                              <option value="completed">Completed</option>
                            </select>
                          ) : pr.status === "completed" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">Completed</span>
                          ) : pr.current_office ? (
                            <span className={"px-1.5 py-0.5 rounded text-[10px] font-medium " + (pr.overdue ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700")}>
                              {pr.current_office} · {pr.days_in_step}d
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[10px]">Not started</span>
                          )}
                          {canEditMonitoring && pr.status === "in_progress" && pr.overdue && (
                            <span className="ml-1 text-[10px] text-red-600">{pr.days_in_step}d</span>
                          )}
                        </td>
                        <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(pr.created_at).toLocaleString()}>
                          {formatWhen(pr.created_at)}
                        </td>
                        {canEditMonitoring && (
                          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                            {pr.status === "in_progress" && (
                              <button className="text-psu text-[11px] underline mr-2" onClick={() => setEditingPrId(pr.id)}>Edit</button>
                            )}
                            {pr.status !== "cancelled" ? (
                              <button
                                className="text-red-600 text-[11px] underline disabled:opacity-40"
                                disabled={statusBusyId === pr.id}
                                onClick={() => cancelPr(pr)}
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                className="text-red-600 text-[11px] underline disabled:opacity-40"
                                disabled={statusBusyId === pr.id}
                                onClick={() => deletePr(pr)}
                              >
                                Delete
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
                  {purchaseRequests.length > 0 && prGroups.every(([, rows]) => rows.length === 0) && (
                    <tr><td colSpan={canEditMonitoring ? 8 : 7} className="py-3 text-slate-400">No purchase requests match this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {editingPrId != null && (
            <PurchaseRequestEditPanel
              prId={editingPrId}
              onClose={() => setEditingPrId(null)}
              onSaved={() => { setEditingPrId(null); load(); }}
            />
          )}

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
        body: JSON.stringify({ campus_id: campusId === UNIVERSITY_WIDE ? null : Number(campusId), period: period.trim(), amount: Number(amount) }),
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
            <option value={UNIVERSITY_WIDE}>University-wide / Digital</option>
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

/** Edit a Purchase Request's header fields and each line item's
 *  quantity/unit cost -- not which titles are on it (see
 *  PATCH /api/purchase-request/:id). Loads the full row (including items,
 *  which the Monitoring list itself doesn't carry) on open. */
function PurchaseRequestEditPanel({
  prId, onClose, onSaved,
}: {
  prId: number; onClose: () => void; onSaved: () => void;
}) {
  const [pr, setPr] = useState<FullPurchaseRequest | null>(null);
  const [items, setItems] = useState<PersistedPRItem[]>([]);
  const [office, setOffice] = useState("");
  const [purpose, setPurpose] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    apiFetch(`/api/purchase-request/${prId}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        const row: FullPurchaseRequest = j.pr;
        setPr(row);
        setItems(row.items ?? []);
        setOffice(row.office ?? "");
        setPurpose(row.purpose ?? "");
        setRequestedBy(row.requested_by ?? "");
        setApprovedBy(row.approved_by ?? "");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [prId]);

  function setItemField(i: number, field: "quantity" | "unit_cost", value: number) {
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [field]: Math.max(field === "quantity" ? 1 : 0, value) } : it));
  }

  const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_cost || 0), 0);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/purchase-request/${prId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          office, purpose, requested_by: requestedBy, approved_by: approvedBy,
          items: items.map((i) => ({ quantity: i.quantity, unit_cost: i.unit_cost })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card border-psu">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-psu font-semibold">Edit {pr?.pr_no || "Purchase Request"}</h2>
        <button className="text-slate-400 text-xs underline" onClick={onClose}>Close</button>
      </div>
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}
      {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
      {!loading && pr && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Office / Section</span>
              <input className="input w-full text-sm" value={office} onChange={(e) => setOffice(e.target.value)} />
            </label>
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Requested By</span>
              <input className="input w-full text-sm" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
            </label>
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Approved By</span>
              <input className="input w-full text-sm" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
            </label>
            <label className="label flex-col items-start gap-1 sm:col-span-2">
              <span className="text-xs">Purpose</span>
              <textarea className="input w-full text-sm h-16 resize-none" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </label>
          </div>

          <div className="overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right w-20">Qty</th>
                  <th className="py-1 pr-2 text-right w-28">Unit Cost</th>
                  <th className="py-1 pl-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">{item.description}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min="1" className="input w-16 text-right text-xs py-0.5"
                        value={item.quantity} onChange={(e) => setItemField(i, "quantity", Number(e.target.value))} />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min="0" step="0.01" className="input w-24 text-right text-xs py-0.5"
                        value={item.unit_cost} onChange={(e) => setItemField(i, "unit_cost", Number(e.target.value))} />
                    </td>
                    <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{money((item.quantity || 0) * (item.unit_cost || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-slate-500">Grand Total: </span>
              <span className="font-semibold text-psu">{money(total)}</span>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline text-xs" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn text-xs" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type PoItem = { stock_prop_no: string; unit: string; description: string; quantity: number; unit_cost: number; source_pr_nos?: string[]; canvassing_ids?: number[]; priced_at?: string };

function todayLong(): string {
  return new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

/** Consolidates every non-cancelled Purchase Request's line items for one
 *  supplier into a single editable Purchase Order -- see
 *  /api/purchase-order/consolidated for the merge logic (same title across
 *  multiple PRs becomes one line, quantities summed) and lib/exports-po.ts
 *  for the generated document itself. */
function GeneratePoPanel({
  supplier, onClose, onGenerated,
}: {
  supplier: string; onClose: () => void; onGenerated: () => void;
}) {
  const [items, setItems] = useState<PoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [transNo, setTransNo] = useState("");
  const [philgepsRefNo, setPhilgepsRefNo] = useState("");
  const [address, setAddress] = useState("");
  const [tin, setTin] = useState("");
  const [poNo, setPoNo] = useState("");
  const [date, setDate] = useState(todayLong());
  const [modeOfProcurement, setModeOfProcurement] = useState("Direct Contracting");
  const [placeOfDelivery, setPlaceOfDelivery] = useState("PSU Supply Stockroom (Library Services)");
  const [deliveryTerm, setDeliveryTerm] = useState("30 Calendar Days (FOB Destination)");
  const [dateOfDelivery, setDateOfDelivery] = useState("30 days from receipt of Purchase Order");
  const [paymentTerm, setPaymentTerm] = useState("30 Days");
  const [fundCluster, setFundCluster] = useState("");
  const [orsBursNo, setOrsBursNo] = useState("");
  const [dateOfOrsBurs, setDateOfOrsBurs] = useState("");
  const [approvedByName, setApprovedByName] = useState("");
  const [approvedByTitle, setApprovedByTitle] = useState("University President");
  const [notes, setNotes] = useState("");
  const [excludedCount, setExcludedCount] = useState(0);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    apiFetch(`/api/purchase-order/consolidated?supplier=${encodeURIComponent(supplier)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setItems(j.items ?? []);
        setExcludedCount(j.excludedCount ?? 0);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [supplier]);

  function setItemField(i: number, field: "quantity" | "unit_cost", value: number) {
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [field]: Math.max(field === "quantity" ? 1 : 0, value) } : it));
  }
  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);

  async function generate() {
    if (items.length === 0) return;
    setGenerating(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/purchase-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transNo, philgepsRefNo, supplier, address, tin, poNo, date, modeOfProcurement,
          placeOfDelivery, deliveryTerm, dateOfDelivery, paymentTerm, fundCluster, orsBursNo, dateOfOrsBurs,
          approvedByName, approvedByTitle, notes,
          items: items.map((i) => ({ stock_prop_no: i.stock_prop_no, unit: i.unit, description: i.description, quantity: i.quantity, unit_cost: i.unit_cost, canvassing_ids: i.canvassing_ids ?? [], priced_at: i.priced_at || "" })),
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const fname = `PO_${(poNo || "draft").replace(/[^A-Za-z0-9_-]/g, "_")}.xlsx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      onGenerated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card border-psu">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-psu font-semibold">Generate Purchase Order — {supplier}</h2>
        <button className="text-slate-400 text-xs underline" onClick={onClose}>Close</button>
      </div>
      {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
      {loading && <p className="text-slate-500 text-sm">Loading consolidated items…</p>}
      {!loading && (
        <>
          {excludedCount > 0 && (
            <p className="text-slate-500 text-xs mb-3">
              {excludedCount} item(s) excluded -- already on another active purchase order for this supplier.
            </p>
          )}
          {items.some((i) => isPriceStale(i.priced_at || "")) && (
            <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-3">
              <p className="text-sm font-semibold text-amber-800">
                {items.filter((i) => isPriceStale(i.priced_at || "")).length} item(s) below were priced over {PRICE_VALIDITY_DAYS} days ago.
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Confirm current pricing with {supplier} before generating this PO -- edit the Unit Cost for any item
                whose price has changed (marked ⚠ below).
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <label className="label flex-col items-start gap-1"><span className="text-xs">Trans No.</span>
              <input className="input w-full text-sm" value={transNo} onChange={(e) => setTransNo(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">PhilGEPS Ref No.</span>
              <input className="input w-full text-sm" value={philgepsRefNo} onChange={(e) => setPhilgepsRefNo(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">P.O. No.</span>
              <input className="input w-full text-sm" placeholder="e.g. 2026-DC-001" value={poNo} onChange={(e) => setPoNo(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1 sm:col-span-2"><span className="text-xs">Supplier Address</span>
              <input className="input w-full text-sm" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">TIN</span>
              <input className="input w-full text-sm" value={tin} onChange={(e) => setTin(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Date</span>
              <input className="input w-full text-sm" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Mode of Procurement</span>
              <input className="input w-full text-sm" value={modeOfProcurement} onChange={(e) => setModeOfProcurement(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Place of Delivery</span>
              <input className="input w-full text-sm" value={placeOfDelivery} onChange={(e) => setPlaceOfDelivery(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Delivery Term</span>
              <input className="input w-full text-sm" value={deliveryTerm} onChange={(e) => setDeliveryTerm(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Date of Delivery</span>
              <input className="input w-full text-sm" value={dateOfDelivery} onChange={(e) => setDateOfDelivery(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Payment Term</span>
              <input className="input w-full text-sm" value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Fund Cluster</span>
              <input className="input w-full text-sm" value={fundCluster} onChange={(e) => setFundCluster(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">ORS/BURS No.</span>
              <input className="input w-full text-sm" value={orsBursNo} onChange={(e) => setOrsBursNo(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Date of ORS/BURS</span>
              <input className="input w-full text-sm" value={dateOfOrsBurs} onChange={(e) => setDateOfOrsBurs(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Approved By (Name)</span>
              <input className="input w-full text-sm" value={approvedByName} onChange={(e) => setApprovedByName(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Approved By (Title)</span>
              <input className="input w-full text-sm" value={approvedByTitle} onChange={(e) => setApprovedByTitle(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1 sm:col-span-3"><span className="text-xs">Notes (shown under the item table)</span>
              <input className="input w-full text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>

          <div className="overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2">From PR(s)</th>
                  <th className="py-1 pr-2 text-right w-20">Qty</th>
                  <th className="py-1 pr-2 text-right w-28">Unit Cost</th>
                  <th className="py-1 pr-2 text-right">Total</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">{item.description}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{(item.source_pr_nos ?? []).join(", ")}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min="1" className="input w-16 text-right text-xs py-0.5"
                        value={item.quantity} onChange={(e) => setItemField(i, "quantity", Number(e.target.value))} />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min="0" step="0.01" className="input w-24 text-right text-xs py-0.5"
                        value={item.unit_cost} onChange={(e) => setItemField(i, "unit_cost", Number(e.target.value))} />
                      {isPriceStale(item.priced_at || "") && (
                        <span className="ml-1 text-amber-600" title={`Priced ${daysSincePriced(item.priced_at || "")} days ago -- verify with supplier`}>⚠</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{money(item.quantity * item.unit_cost)}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <button className="text-red-500 text-[11px] underline" onClick={() => removeItem(i)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-slate-400">No active line items found for this supplier.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-slate-500">Grand Total: </span>
              <span className="font-semibold text-psu">{money(total)}</span>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline text-xs" onClick={onClose} disabled={generating}>Cancel</button>
              <button className="btn text-xs" disabled={generating || items.length === 0} onClick={generate}>
                {generating ? "Generating…" : "Generate PO XLSX"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Edit a Purchase Order's header fields and each line item's
 *  quantity/unit cost (not which titles are on it), same scope as
 *  PurchaseRequestEditPanel. Blocked once cancelled. */
function PurchaseOrderEditPanel({
  poId, onClose, onSaved,
}: {
  poId: number; onClose: () => void; onSaved: () => void;
}) {
  const [po, setPo] = useState<FullPurchaseOrder | null>(null);
  const [items, setItems] = useState<FullPurchaseOrder["items"]>([]);
  const [address, setAddress] = useState("");
  const [tin, setTin] = useState("");
  const [modeOfProcurement, setModeOfProcurement] = useState("");
  const [placeOfDelivery, setPlaceOfDelivery] = useState("");
  const [deliveryTerm, setDeliveryTerm] = useState("");
  const [dateOfDelivery, setDateOfDelivery] = useState("");
  const [paymentTerm, setPaymentTerm] = useState("");
  const [fundCluster, setFundCluster] = useState("");
  const [orsBursNo, setOrsBursNo] = useState("");
  const [dateOfOrsBurs, setDateOfOrsBurs] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    apiFetch(`/api/purchase-order/${poId}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        const row: FullPurchaseOrder = j.po;
        setPo(row);
        setItems(row.items ?? []);
        setAddress(row.address ?? ""); setTin(row.tin ?? "");
        setModeOfProcurement(row.mode_of_procurement ?? ""); setPlaceOfDelivery(row.place_of_delivery ?? "");
        setDeliveryTerm(row.delivery_term ?? ""); setDateOfDelivery(row.date_of_delivery ?? "");
        setPaymentTerm(row.payment_term ?? ""); setFundCluster(row.fund_cluster ?? "");
        setOrsBursNo(row.ors_burs_no ?? ""); setDateOfOrsBurs(row.date_of_ors_burs ?? "");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [poId]);

  function setItemField(i: number, field: "quantity" | "unit_cost", value: number) {
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [field]: Math.max(field === "quantity" ? 1 : 0, value) } : it));
  }

  const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_cost || 0), 0);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/purchase-order/${poId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address, tin, mode_of_procurement: modeOfProcurement, place_of_delivery: placeOfDelivery,
          delivery_term: deliveryTerm, date_of_delivery: dateOfDelivery, payment_term: paymentTerm,
          fund_cluster: fundCluster, ors_burs_no: orsBursNo, date_of_ors_burs: dateOfOrsBurs,
          items: items.map((i) => ({ quantity: i.quantity, unit_cost: i.unit_cost })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card border-psu">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-psu font-semibold">Edit {po?.po_no || "Purchase Order"}</h2>
        <button className="text-slate-400 text-xs underline" onClick={onClose}>Close</button>
      </div>
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}
      {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
      {!loading && po && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <label className="label flex-col items-start gap-1 sm:col-span-2"><span className="text-xs">Supplier Address</span>
              <input className="input w-full text-sm" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">TIN</span>
              <input className="input w-full text-sm" value={tin} onChange={(e) => setTin(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Mode of Procurement</span>
              <input className="input w-full text-sm" value={modeOfProcurement} onChange={(e) => setModeOfProcurement(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Place of Delivery</span>
              <input className="input w-full text-sm" value={placeOfDelivery} onChange={(e) => setPlaceOfDelivery(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Delivery Term</span>
              <input className="input w-full text-sm" value={deliveryTerm} onChange={(e) => setDeliveryTerm(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Date of Delivery</span>
              <input className="input w-full text-sm" value={dateOfDelivery} onChange={(e) => setDateOfDelivery(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Payment Term</span>
              <input className="input w-full text-sm" value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Fund Cluster</span>
              <input className="input w-full text-sm" value={fundCluster} onChange={(e) => setFundCluster(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">ORS/BURS No.</span>
              <input className="input w-full text-sm" value={orsBursNo} onChange={(e) => setOrsBursNo(e.target.value)} /></label>
            <label className="label flex-col items-start gap-1"><span className="text-xs">Date of ORS/BURS</span>
              <input className="input w-full text-sm" value={dateOfOrsBurs} onChange={(e) => setDateOfOrsBurs(e.target.value)} /></label>
          </div>

          <div className="overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right w-20">Qty</th>
                  <th className="py-1 pr-2 text-right w-28">Unit Cost</th>
                  <th className="py-1 pl-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">{item.description}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min="1" className="input w-16 text-right text-xs py-0.5"
                        value={item.quantity} onChange={(e) => setItemField(i, "quantity", Number(e.target.value))} />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min="0" step="0.01" className="input w-24 text-right text-xs py-0.5"
                        value={item.unit_cost} onChange={(e) => setItemField(i, "unit_cost", Number(e.target.value))} />
                    </td>
                    <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{money((item.quantity || 0) * (item.unit_cost || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-slate-500">Grand Total: </span>
              <span className="font-semibold text-psu">{money(total)}</span>
            </div>
            <div className="flex gap-2">
              <button className="btn-outline text-xs" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn text-xs" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
