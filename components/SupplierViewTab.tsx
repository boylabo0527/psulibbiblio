"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { isSpreadsheet, parseSheetRows } from "@/lib/parse-client";
import type { SupplierNeedRow } from "@/app/api/supplier/needs/route";
import type { SupplierOfferRow } from "@/app/api/supplier/offers/route";

const UPLOAD_ALIASES: Record<string, string[]> = {
  course_code: ["code", "course code", "course_code"],
  title: ["offer title", "title"],
  author: ["offer author", "author"],
  format: ["offer format", "format"],
  price: ["price", "price (₱)", "price (php)"],
  notes: ["notes"],
};

function normHeader(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function mapUploadRow(row: Record<string, string>): { course_code: string; title: string; author: string; format: string; price: string; notes: string } {
  const normed = new Map(Object.keys(row).map((k) => [normHeader(k), k]));
  const get = (canonical: string) => {
    for (const alt of UPLOAD_ALIASES[canonical]) {
      const actual = normed.get(alt);
      if (actual) return row[actual] ?? "";
    }
    return "";
  };
  return {
    course_code: get("course_code"), title: get("title"), author: get("author"),
    format: get("format"), price: get("price"), notes: get("notes"),
  };
}

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
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; problems: { line: number; course_code: string; reason: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // The export doubles as the bulk-upload template: a supplier downloads
  // this, fills in Offer Title/Author/Format/Price/Notes on whichever rows
  // they can supply -- adding extra rows with the same Code to offer more
  // than one title for a single need -- and uploads it back below.
  function exportCsv() {
    const headers = ["Program", "Code", "Subject", "Have (Printed)", "Have (Digital)", "Titles Needed", "Offer Title", "Offer Author", "Offer Format", "Price", "Notes"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const cells = [r.program, r.course_code, r.course_title, r.current_printed, r.current_digital, r.gap, "", "", "", "", ""]
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

  async function uploadOffersFile(file: File) {
    setUploading(true);
    setErr(null);
    setUploadResult(null);
    try {
      if (!isSpreadsheet(file)) throw new Error("Please upload the .csv or .xlsx file (the same one you downloaded).");
      const rawRows = await parseSheetRows(file);
      const mapped = rawRows.map(mapUploadRow).filter((r) => r.course_code.trim() && r.title.trim());
      if (!mapped.length) {
        throw new Error("No rows with both a Code and an Offer Title were found. Fill those in on the downloaded template first.");
      }
      const res = await apiFetch("/api/supplier/offers/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: mapped }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setUploadResult({ inserted: j.inserted ?? 0, problems: j.problems ?? [] });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-psu font-semibold">Titles We Need</h2>
          <div className="flex gap-2 shrink-0">
            <button className="btn-outline text-xs whitespace-nowrap" disabled={!rows.length} onClick={exportCsv}>
              Download CSV
            </button>
            <button
              className="btn-outline text-xs whitespace-nowrap"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload offers file"}
            </button>
            <input
              ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadOffersFile(f); }}
            />
          </div>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Subjects currently short of the required number of recent titles. Numbers show what&apos;s already in our
          collection (printed / digital) and how many more titles are still needed overall. Click &quot;Offer&quot;
          to propose a title against a specific need, or offer many at once: download the CSV, fill in Offer
          Title/Author/Format/Price/Notes on whichever rows you can supply (add extra rows with the same Code to
          offer more than one title for a need), then upload it back with &quot;Upload offers file&quot;.
        </p>

        {uploadResult && (
          <div className="mb-3 bg-slate-50 border border-slate-200 rounded p-2.5 text-xs">
            <p className={uploadResult.inserted ? "text-green-700" : "text-slate-600"}>
              {uploadResult.inserted
                ? `${uploadResult.inserted} title offer${uploadResult.inserted === 1 ? "" : "s"} submitted from your file.`
                : "No offers were submitted from that file."}
            </p>
            {uploadResult.problems.length > 0 && (
              <div className="text-amber-700 mt-1">
                <p>{uploadResult.problems.length} row{uploadResult.problems.length === 1 ? "" : "s"} skipped:</p>
                <ul className="list-disc ml-4 mt-1">
                  {uploadResult.problems.map((p, i) => (
                    <li key={i}>Row {p.line} (code &quot;{p.course_code}&quot;): {p.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

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
                      <button className="text-psu text-[11px] underline" onClick={() => setOfferFor(r)}>
                        {r.gap > 1 ? `Offer titles` : "Offer"}
                      </button>
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
                  <td className="py-1.5 pr-2 text-slate-500">
                    {o.subject_label || "—"}
                    {o.batch_size && o.batch_size > 1 && (
                      <span className="ml-1 inline-block rounded px-1 py-0.5 text-[9px] font-medium bg-slate-100 text-slate-500" title="Submitted together with other titles for this subject">
                        1 of {o.batch_size}
                      </span>
                    )}
                  </td>
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

type OfferRowInput = { title: string; author: string; format: string; price: string; notes: string };

function emptyOfferRow(): OfferRowInput {
  return { title: "", author: "", format: "", price: "", notes: "" };
}

function OfferForm({
  need, onClose, onSubmitted,
}: {
  need: SupplierNeedRow;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  // Seeded with one row per title still needed (capped so a huge gap
  // doesn't dump 50 blank rows on the supplier) -- they can add or remove
  // rows freely from there.
  const seedCount = Math.max(1, Math.min(need.gap || 1, 10));
  const [items, setItems] = useState<OfferRowInput[]>(() => Array.from({ length: seedCount }, emptyOfferRow));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function updateItem(i: number, patch: Partial<OfferRowInput>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addRow() {
    setItems((prev) => [...prev, emptyOfferRow()]);
  }
  function removeRow(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    const filled = items.filter((it) => it.title.trim());
    if (!filled.length) { setErr("At least one title is required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/supplier/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: need.subject_id,
          offers: filled.map((it) => ({
            title: it.title, author: it.author, format: it.format,
            price: it.price.trim() === "" ? null : Number(it.price), notes: it.notes,
          })),
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
      <h3 className="text-psu font-semibold mb-1">Offer titles for &quot;{need.course_title}&quot;</h3>
      <p className="text-xs text-slate-500 mb-3">
        {need.program} · {need.course_code} · needs {need.gap} more title{need.gap === 1 ? "" : "s"}
      </p>

      <div className="space-y-3 mb-3">
        {items.map((it, i) => (
          <div key={i} className="border border-slate-200 rounded p-2.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Title {i + 1}</span>
              {items.length > 1 && (
                <button className="text-red-600 text-[11px] underline" onClick={() => removeRow(i)}>Remove</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="label flex-col items-start">
                Title
                <input className="input w-full" value={it.title} onChange={(e) => updateItem(i, { title: e.target.value })} />
              </label>
              <label className="label flex-col items-start">
                Author
                <input className="input w-full" value={it.author} onChange={(e) => updateItem(i, { author: e.target.value })} />
              </label>
              <label className="label flex-col items-start">
                Format (e.g. printed book, ebook)
                <input className="input w-full" value={it.format} onChange={(e) => updateItem(i, { format: e.target.value })} />
              </label>
              <label className="label flex-col items-start">
                Price (₱)
                <input type="number" min={0} step="0.01" className="input w-full" value={it.price} onChange={(e) => updateItem(i, { price: e.target.value })} />
              </label>
              <label className="label flex-col items-start col-span-2">
                Notes (availability, edition, etc.)
                <textarea className="input w-full" rows={2} value={it.notes} onChange={(e) => updateItem(i, { notes: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-outline text-xs mb-3" onClick={addRow}>+ Add another title</button>

      {err && <p className="text-red-700 text-xs mb-2">{err}</p>}
      <div className="flex gap-2">
        <button className="btn text-xs" disabled={busy} onClick={submit}>
          {busy ? "Submitting…" : items.filter((it) => it.title.trim()).length > 1 ? "Submit all titles" : "Submit offer"}
        </button>
        <button className="btn-outline text-xs" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
