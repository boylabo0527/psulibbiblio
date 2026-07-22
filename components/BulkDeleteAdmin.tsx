"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useCampuses } from "@/lib/use-campuses";
import { RESOURCE_TYPES } from "@/lib/resources";

type Table = "titles" | "subjects" | "canvassing";
type Program = { id: number; name: string };

export default function BulkDeleteAdmin() {
  const [table, setTable] = useState<Table>("titles");
  const [format, setFormat] = useState("");
  const [campus, setCampus] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [programId, setProgramId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const campuses = useCampuses();

  useEffect(() => {
    apiFetch("/api/programs").then((r) => r.json()).then((j) => setPrograms(j.programs ?? [])).catch(() => {});
  }, []);

  // Any filter change invalidates a stale preview count.
  function invalidate() {
    setPreviewCount(null);
    setResult(null);
  }

  function body(dryRun: boolean) {
    const b: Record<string, unknown> = { table, dryRun };
    if (table === "titles") {
      if (format) b.format = format;
      if (campus) b.campus = campus;
      if (fromYear) b.fromYear = Number(fromYear);
      if (toYear) b.toYear = Number(toYear);
    } else if (table === "subjects") {
      if (programId) b.programId = Number(programId);
    } else {
      if (fromDate) b.fromDate = fromDate;
      if (toDate) b.toDate = toDate;
    }
    return b;
  }

  async function preview() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await apiFetch("/api/admin/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(true)),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setPreviewCount(j.count);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (previewCount === null) return;
    if (!confirm(`Delete ${previewCount} row(s) from ${table}? This cannot be undone.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(false)),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setResult(`Deleted ${j.count} row(s) from ${table}.`);
      setPreviewCount(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-red-300">
      <h2 className="text-red-700 font-semibold mb-2">Admin — Delete by Filter</h2>
      <p className="text-xs text-slate-500 mb-3">
        Choose a table and narrow it down with the filters below, then preview the count before
        deleting. Nothing is removed until you confirm the preview.
      </p>

      <div className="flex flex-wrap gap-3 mb-3">
        <label className="label">
          Table
          <select className="input ml-1" value={table} onChange={(e) => { setTable(e.target.value as Table); invalidate(); }}>
            <option value="titles">Titles</option>
            <option value="subjects">Subjects (courses)</option>
            <option value="canvassing">Canvassing entries</option>
          </select>
        </label>

        {table === "titles" && (
          <>
            <label className="label">
              Type
              <select className="input ml-1" value={format} onChange={(e) => { setFormat(e.target.value); invalidate(); }}>
                <option value="">All types</option>
                {RESOURCE_TYPES.map((rt) => <option key={rt.id} value={rt.id}>{rt.uiLabel}</option>)}
              </select>
            </label>
            <label className="label">
              Campus
              <select className="input ml-1" value={campus} onChange={(e) => { setCampus(e.target.value); invalidate(); }}>
                <option value="">All campuses</option>
                {campuses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </label>
            <label className="label">
              Year from
              <input type="number" className="input ml-1 w-24" value={fromYear} onChange={(e) => { setFromYear(e.target.value); invalidate(); }} />
            </label>
            <label className="label">
              Year to
              <input type="number" className="input ml-1 w-24" value={toYear} onChange={(e) => { setToYear(e.target.value); invalidate(); }} />
            </label>
          </>
        )}

        {table === "subjects" && (
          <label className="label">
            Program
            <select className="input ml-1 min-w-[240px]" value={programId} onChange={(e) => { setProgramId(e.target.value); invalidate(); }}>
              <option value="">All programs</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}

        {table === "canvassing" && (
          <>
            <label className="label">
              Canvass date from
              <input type="date" className="input ml-1" value={fromDate} onChange={(e) => { setFromDate(e.target.value); invalidate(); }} />
            </label>
            <label className="label">
              Canvass date to
              <input type="date" className="input ml-1" value={toDate} onChange={(e) => { setToDate(e.target.value); invalidate(); }} />
            </label>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-outline text-sm" disabled={busy} onClick={preview}>
          {busy ? "Working…" : "Preview count"}
        </button>
        {previewCount !== null && (
          <>
            <span className="text-sm text-slate-600">
              {previewCount} row{previewCount === 1 ? "" : "s"} match{previewCount === 1 ? "es" : ""}.
            </span>
            {previewCount > 0 && (
              <button className="btn bg-red-600 hover:bg-red-700 text-sm" disabled={busy} onClick={confirmDelete}>
                Delete {previewCount} row{previewCount === 1 ? "" : "s"}
              </button>
            )}
          </>
        )}
      </div>

      {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
      {result && <p className="text-green-700 text-sm mt-3">{result}</p>}
    </div>
  );
}
