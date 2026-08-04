"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { PurchaseRequestRow } from "@/app/api/monitoring/route";
import type { SupplierOfferRow } from "@/app/api/supplier/offers/route";

type ProposalRow = SupplierOfferRow & { subject_label?: string };

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

/** Admin/monitoring-role view: every Purchase Request generated and every
 *  supplier proposal submitted, most recent first -- read-only, nothing
 *  here can be edited or reverted (see ActivityLogTab/PurchaseRequestTab/
 *  SupplierViewTab for the corresponding action tabs). */
export default function MonitoringTab() {
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequestRow[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await apiFetch("/api/monitoring");
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
        setPurchaseRequests(j.purchaseRequests ?? []);
        setProposals(j.proposals ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      {err && <p className="text-red-700 text-sm">{err}</p>}
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}

      {!loading && (
        <>
          <div className="card">
            <h2 className="text-psu font-semibold mb-1">Purchase Requests Generated</h2>
            <p className="text-xs text-slate-500 mb-3">
              Every Purchase Request generated from the Purchase Request tab, most recent first.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2">PR No.</th>
                    <th className="py-1 pr-2">Submitted by</th>
                    <th className="py-1 pr-2">Office</th>
                    <th className="py-1 pr-2">Purpose</th>
                    <th className="py-1 pr-2 text-right">Items</th>
                    <th className="py-1 pr-2 text-right">Total</th>
                    <th className="py-1 pl-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseRequests.map((pr) => (
                    <tr key={pr.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 whitespace-nowrap">{pr.pr_no || "(draft)"}</td>
                      <td className="py-1.5 pr-2">{pr.submitted_by}</td>
                      <td className="py-1.5 pr-2">{pr.office}</td>
                      <td className="py-1.5 pr-2 max-w-[240px] truncate" title={pr.purpose}>{pr.purpose}</td>
                      <td className="py-1.5 pr-2 text-right">{pr.item_count}</td>
                      <td className="py-1.5 pr-2 text-right">{pr.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(pr.created_at).toLocaleString()}>
                        {formatWhen(pr.created_at)}
                      </td>
                    </tr>
                  ))}
                  {purchaseRequests.length === 0 && (
                    <tr><td colSpan={7} className="py-3 text-slate-400">No purchase requests generated yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 className="text-psu font-semibold mb-1">Proposals Submitted</h2>
            <p className="text-xs text-slate-500 mb-3">
              Every supplier offer submitted from the Supplier View tab, most recent first.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1 pr-2">Supplier</th>
                    <th className="py-1 pr-2">Title</th>
                    <th className="py-1 pr-2">Author</th>
                    <th className="py-1 pr-2">Course</th>
                    <th className="py-1 pr-2">Format</th>
                    <th className="py-1 pr-2 text-right">Price</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pl-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2">{o.supplier_email}</td>
                      <td className="py-1.5 pr-2 max-w-[220px] truncate" title={o.title}>{o.title}</td>
                      <td className="py-1.5 pr-2">{o.author}</td>
                      <td className="py-1.5 pr-2">{o.subject_label}</td>
                      <td className="py-1.5 pr-2">{o.format}</td>
                      <td className="py-1.5 pr-2 text-right">{o.price != null ? o.price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ""}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[o.status] ?? "bg-slate-100 text-slate-700"}`}>
                          {o.status}
                        </span>
                      </td>
                      <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(o.created_at).toLocaleString()}>
                        {formatWhen(o.created_at)}
                      </td>
                    </tr>
                  ))}
                  {proposals.length === 0 && (
                    <tr><td colSpan={8} className="py-3 text-slate-400">No proposals submitted yet.</td></tr>
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
