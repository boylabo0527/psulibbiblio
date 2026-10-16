"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

type SampleRow = { id: number; title: string; call_no: string; barcodes: string[] | null };

export default function ReclassifyJournalsAdmin() {
  const [busy, setBusy] = useState(false);
  const [toJournal, setToJournal] = useState<number | null>(null);
  const [toBook, setToBook] = useState<number | null>(null);
  const [sample, setSample] = useState<{ toJournal: SampleRow[]; toBook: SampleRow[] }>({ toJournal: [], toBook: [] });
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function preview() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await apiFetch("/api/admin/reclassify-journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setToJournal(j.toJournal);
      setToBook(j.toBook);
      setSample(j.sample ?? { toJournal: [], toBook: [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmApply() {
    const total = (toJournal ?? 0) + (toBook ?? 0);
    if (!total) return;
    if (!confirm(`Reclassify ${total} Main Campus title(s) -- ${toJournal} book${toJournal === 1 ? "" : "s"} to journal, ${toBook} journal${toBook === 1 ? "" : "s"} to book -- based on their barcode? This cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/reclassify-journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setResult(`Reclassified ${j.toJournal} title(s) to journal, ${j.toBook} title(s) to book.`);
      setToJournal(null);
      setToBook(null);
      setSample({ toJournal: [], toBook: [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const total = (toJournal ?? 0) + (toBook ?? 0);
  const renderSample = (rows: SampleRow[], toLabel: string) => rows.map((r) => (
    <tr key={r.id} className="border-b border-slate-100">
      <td className="py-1 pr-2">{r.title}</td>
      <td className="py-1 pr-2">{r.call_no}</td>
      <td className="py-1 pr-2">{(r.barcodes ?? []).join(", ")}</td>
      <td className="py-1 pr-2">{toLabel}</td>
    </tr>
  ));

  return (
    <div className="card border-amber-300">
      <h2 className="text-amber-700 font-semibold mb-2">Admin — Reclassify Main Campus Books/Journals by Barcode</h2>
      <p className="text-xs text-slate-500 mb-3">
        One-time catch-up for titles synced/uploaded before the Destiny sync started splitting books from journals
        by barcode (see the &quot;Sync Printed Books &amp; Journals from Destiny&quot; card above): a printed book
        whose barcode actually starts with &quot;PSUMLJ&quot; is really a journal, and vice versa. Flips just the
        format column -- existing course/program matches and locks carry over unchanged. Preview first -- nothing
        changes until you confirm.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-outline text-sm" disabled={busy} onClick={preview}>
          {busy ? "Working…" : "Preview"}
        </button>
        {toJournal !== null && (
          <>
            <span className="text-sm text-slate-600">
              {toJournal} book{toJournal === 1 ? "" : "s"} -&gt; journal, {toBook} journal{toBook === 1 ? "" : "s"} -&gt; book.
            </span>
            {total > 0 && (
              <button className="btn bg-amber-600 hover:bg-amber-700 text-sm" disabled={busy} onClick={confirmApply}>
                Reclassify {total} title{total === 1 ? "" : "s"}
              </button>
            )}
          </>
        )}
      </div>

      {(sample.toJournal.length > 0 || sample.toBook.length > 0) && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1 pr-2">Title</th><th className="py-1 pr-2">Call No.</th>
                <th className="py-1 pr-2">Barcodes</th><th className="py-1 pr-2">Becomes</th>
              </tr>
            </thead>
            <tbody>
              {renderSample(sample.toJournal, "Journal")}
              {renderSample(sample.toBook, "Book")}
            </tbody>
          </table>
          {(toJournal ?? 0) + (toBook ?? 0) > sample.toJournal.length + sample.toBook.length && (
            <p className="text-xs text-slate-400 mt-1">…and more not shown.</p>
          )}
        </div>
      )}

      {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
      {result && <p className="text-green-700 text-sm mt-3">{result}</p>}
    </div>
  );
}
