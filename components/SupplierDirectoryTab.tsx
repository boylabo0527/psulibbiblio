"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import type { SupplierRow } from "@/app/api/suppliers/route";

type DraftSupplier = { name: string; address: string; contact_person: string; phone: string; email: string; tin: string; notes: string };
function emptyDraft(): DraftSupplier {
  return { name: "", address: "", contact_person: "", phone: "", email: "", tin: "", notes: "" };
}

/** A reference directory of known suppliers -- address, contact person,
 *  phone, email, TIN -- so onboarding a new supplier account or
 *  coordinating a delivery doesn't require digging through old Purchase
 *  Orders or canvassing notes to find their info again. */
export default function SupplierDirectoryTab() {
  const { perms } = usePermissions();
  const canEdit = perms.isAdmin || !!perms.tabs["supplier-directory"]?.can_edit;

  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const [draft, setDraft] = useState<DraftSupplier>(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    setErr(null);
    apiFetch("/api/suppliers")
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setRows(j.rows ?? []); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function startEdit(r: SupplierRow) {
    setEditingId(r.id);
    setDraft({ name: r.name, address: r.address, contact_person: r.contact_person, phone: r.phone, email: r.email, tin: r.tin, notes: r.notes });
  }
  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = editingId != null
        ? await apiFetch(`/api/suppliers/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) })
        : await apiFetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      cancelEdit();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(r: SupplierRow) {
    if (!confirm(`Remove "${r.name}" from the supplier directory?`)) return;
    setBusyId(r.id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/suppliers/${r.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const q = search.trim().toLowerCase();
  const displayed = q
    ? rows.filter((r) => [r.name, r.contact_person, r.address, r.phone, r.email].some((f) => f.toLowerCase().includes(q)))
    : rows;

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-1">{editingId != null ? "Edit Supplier" : "Add Supplier"}</h2>
          <p className="text-xs text-slate-500 mb-3">
            A reference directory for account creation and coordination -- name, address, contact person, phone,
            email, and TIN, so this info doesn&apos;t have to be dug out of old POs each time.
          </p>
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Name *</span>
              <input className="input w-full" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </label>
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Contact person</span>
              <input className="input w-full" value={draft.contact_person} onChange={(e) => setDraft((d) => ({ ...d, contact_person: e.target.value }))} />
            </label>
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Phone</span>
              <input className="input w-full" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
            </label>
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Email</span>
              <input className="input w-full" type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
            </label>
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">TIN</span>
              <input className="input w-full" value={draft.tin} onChange={(e) => setDraft((d) => ({ ...d, tin: e.target.value }))} />
            </label>
            <label className="label flex-col items-start gap-1 sm:col-span-2 lg:col-span-2">
              <span className="text-xs">Address</span>
              <input className="input w-full" value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} />
            </label>
            <label className="label flex-col items-start gap-1 sm:col-span-2 lg:col-span-3">
              <span className="text-xs">Notes</span>
              <textarea className="input w-full h-14 resize-none" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            </label>
            <div className="sm:col-span-2 lg:col-span-3 flex gap-2">
              <button type="submit" className="btn text-sm" disabled={submitting || !draft.name.trim()}>
                {submitting ? "Saving…" : editingId != null ? "Save Changes" : "Add Supplier"}
              </button>
              {editingId != null && (
                <button type="button" className="btn-outline text-sm" onClick={cancelEdit}>Cancel</button>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-psu font-semibold">Supplier Directory</h2>
          <input
            className="input text-xs py-1 w-full max-w-xs"
            placeholder="Search name, contact, address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && displayed.length === 0 && <p className="text-slate-500 text-sm">No suppliers in the directory yet.</p>}
        {!loading && displayed.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Contact person</th>
                  <th className="py-1 pr-2">Phone</th>
                  <th className="py-1 pr-2">Email</th>
                  <th className="py-1 pr-2">Address</th>
                  <th className="py-1 pr-2">TIN</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.contact_person || "—"}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.phone || "—"}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{r.email || "—"}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{r.address || "—"}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{r.tin || "—"}</td>
                    <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button className="text-psu text-[11px] underline mr-2" onClick={() => startEdit(r)}>Edit</button>
                          <button className="text-red-600 text-[11px] underline" disabled={busyId === r.id} onClick={() => remove(r)}>Remove</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
