"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { SupplierNeedRow } from "@/app/api/supplier/needs/route";
import type { SupplierOfferRow } from "@/app/api/supplier/offers/route";

const STATUS_LABEL: Record<string, string> = { pending: "Pending", accepted: "Accepted", declined: "Declined" };
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  accepted: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
};

export default function SupplierViewTab() {
  const [rows, setRows] = useState<SupplierNeedRow[]>([]);
  const [offers, setOffers] = useState<SupplierOfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [offerFor, setOfferFor] = useState<SupplierNeedRow | null>(null);

  function load() {
    setLoading(true);
    setErr(null);
    Promise.all([
      apiFetch("/api/supplier/needs").then((r) => r.json()),
      apiFetch("/api/supplier/offers").then((r) => r.json()),
    ])
      .then(([needsJ, offersJ]) => {
        if (needsJ.error) throw new Error(needsJ.error);
        if (offersJ.error) throw new Error(offersJ.error);
        setRows(needsJ.rows ?? []);
        setOffers(offersJ.rows ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function exportCsv() {
    const headers = ["Program", "Code", "Subject", "Have (Printed)", "Have (Digital)", "Titles Needed"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const cells = [r.program, r.course_code, r.course_title, r.current_printed, r.current_digital, r.gap]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "titles_we_need.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-psu font-semibold">Titles We Need</h2>
          <button className="btn-outline text-xs whitespace-nowrap" disabled={!rows.length} onClick={exportCsv}>
            Download CSV
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Subjects currently short of the required number of recent titles. Numbers show what&apos;s already in our
          collection (printed / digital) and how many more titles are still needed overall. Click &quot;Offer&quot;
          to propose a title against a specific need.
        </p>

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && rows.length === 0 && <p className="text-slate-500 text-sm">No open needs right now.</p>}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2">Program</th>
                  <th className="py-1 pr-2 w-24">Code</th>
                  <th className="py-1 pr-2">Subject</th>
                  <th className="py-1 px-2 text-right">Have (Printed)</th>
                  <th className="py-1 px-2 text-right">Have (Digital)</th>
                  <th className="py-1 px-2 text-right">Titles Needed</th>
                  <th className="py-1 pl-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{r.course_code}</td>
                    <td className="py-1.5 pr-2">{r.course_title}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.current_printed}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.current_digital}</td>
                    <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-red-600">+{r.gap}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <button className="text-psu text-[11px] underline" onClick={() => setOfferFor(r)}>Offer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {offerFor && (
        <OfferForm need={offerFor} onClose={() => setOfferFor(null)} onSubmitted={() => { setOfferFor(null); load(); }} />
      )}

      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Your Submitted Offers</h2>
        {!loading && offers.length === 0 && <p className="text-slate-500 text-sm">No offers submitted yet.</p>}
        {!loading && offers.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-left">
                <th className="py-1 pr-2">Subject</th>
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 px-2">Format</th>
                <th className="py-1 px-2 text-right">Price</th>
                <th className="py-1 pl-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 text-slate-500">{o.subject_label || "—"}</td>
                  <td className="py-1.5 pr-2">{o.title}</td>
                  <td className="py-1.5 px-2 text-slate-500">{o.format || "—"}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{o.price != null ? o.price.toLocaleString() : "—"}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <span className={"inline-block rounded px-1.5 py-0.5 text-[10px] font-medium " + STATUS_COLOR[o.status]}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function OfferForm({
  need, onClose, onSubmitted,
}: {
  need: SupplierNeedRow;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [format, setFormat] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setErr("Title is required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/supplier/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: need.subject_id, title, author, format,
          price: price.trim() === "" ? null : Number(price), notes,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-2 border-psu-light">
      <h3 className="text-psu font-semibold mb-1">Offer a title for &quot;{need.course_title}&quot;</h3>
      <p className="text-xs text-slate-500 mb-3">{need.program} · {need.course_code}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="label flex-col items-start">
          Title
          <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="label flex-col items-start">
          Author
          <input className="input w-full" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label className="label flex-col items-start">
          Format (e.g. printed book, ebook)
          <input className="input w-full" value={format} onChange={(e) => setFormat(e.target.value)} />
        </label>
        <label className="label flex-col items-start">
          Price (₱)
          <input type="number" min={0} step="0.01" className="input w-full" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="label flex-col items-start col-span-2">
          Notes (availability, edition, etc.)
          <textarea className="input w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {err && <p className="text-red-700 text-xs mb-2">{err}</p>}
      <div className="flex gap-2">
        <button className="btn text-xs" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit offer"}</button>
        <button className="btn-outline text-xs" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
