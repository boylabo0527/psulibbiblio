"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

type SampleTitle = { id: number; title: string; author: string; call_no: string; campus: string; copies: number };
type SampleGroup = { titles: SampleTitle[] };

export default function DedupeBarcodesAdmin() {
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<number | null>(null);
  const [rowsToRemove, setRowsToRemove] = useState<number | null>(null);
  const [sample, setSample] = useState<SampleGroup[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function preview() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await apiFetch("/api/admin/dedupe-barcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setGroups(j.groups);
      setRowsToRemove(j.rowsToRemove);
      setSample(j.sample ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMerge() {
    if (!rowsToRemove) return;
    if (!confirm(`Merge ${groups} group(s) of duplicate printed books, removing ${rowsToRemove} row(s)? Copies/barcodes are combined onto the row that's kept -- this cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/dedupe-barcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setResult(`Merged ${j.groupsMerged} group(s), removed ${j.rowsRemoved} duplicate row(s).`);
      setGroups(null);
      setRowsToRemove(null);
      setSample([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-amber-300">
      <h2 className="text-amber-700 font-semibold mb-2">Admin — Dedupe Printed Books by Barcode</h2>
      <p className="text-xs text-slate-500 mb-3">
        Finds printed-book rows that share a barcode -- the same physical copy entered twice, most often once by a
        manual upload and once by a Destiny sync that didn&apos;t recognize it as the same title (call number,
        author, or campus typed slightly differently). Merges each such group down to one row; copies and barcode
        lists are combined (not just summed), so nothing gets double- or under-counted. Preview first --
        nothing changes until you confirm.
      </p>

      <div className="flex items-center gap-3">
        <button className="btn-outline text-sm" disabled={busy} onClick={preview}>
          {busy ? "Working…" : "Preview"}
        </button>
        {groups !== null && (
          <>
            <span className="text-sm text-slate-600">
              {groups} duplicate group{groups === 1 ? "" : "s"} found ({rowsToRemove} row{rowsToRemove === 1 ? "" : "s"} would be removed).
            </span>
            {groups > 0 && (
              <button className="btn bg-amber-600 hover:bg-amber-700 text-sm" disabled={busy} onClick={confirmMerge}>
                Merge {groups} group{groups === 1 ? "" : "s"}
              </button>
            )}
          </>
        )}
      </div>

      {sample.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1 pr-2">Title</th><th className="py-1 pr-2">Author</th>
                <th className="py-1 pr-2">Call No.</th><th className="py-1 pr-2">Campus</th>
                <th className="py-1 pr-2 text-right">Copies</th>
              </tr>
            </thead>
            <tbody>
              {sample.map((g) =>
                g.titles.map((r, ri) => (
                  <tr key={r.id} className={"border-b " + (ri === g.titles.length - 1 ? "border-slate-300" : "border-slate-100")}>
                    <td className="py-1 pr-2">{r.title}</td>
                    <td className="py-1 pr-2">{r.author}</td>
                    <td className="py-1 pr-2">{r.call_no}</td>
                    <td className="py-1 pr-2">{r.campus}</td>
                    <td className="py-1 pr-2 text-right">{r.copies}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          {groups !== null && groups > sample.length && (
            <p className="text-xs text-slate-400 mt-1">…and {groups - sample.length} more group(s) not shown.</p>
          )}
        </div>
      )}

      {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
      {result && <p className="text-green-700 text-sm mt-3">{result}</p>}
    </div>
  );
}
