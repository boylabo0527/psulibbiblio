"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useCampuses } from "@/lib/use-campuses";
import { RESOURCE_TYPES } from "@/lib/resources";

type Table = "titles" | "subjects" | "canvassing";
type Program = { id: number; name: string };

type TitleSample = { title: string; author: string; format: string; campus: string; year: string; copies: number; provider: string };
type SubjectSample = { course_code: string; course_title: string; program: string };
type CanvassingSample = { title: string; supplier: string; canvass_date: string; unit_cost: number };

export default function BulkDeleteAdmin() {
  const [table, setTable] = useState<Table>("titles");
  const [format, setFormat] = useState("");
  const [campus, setCampus] = useState("");
  const [provider, setProvider] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [search, setSearch] = useState("");
  const [programId, setProgramId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [supplier, setSupplier] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [sample, setSample] = useState<(TitleSample | SubjectSample | CanvassingSample)[]>([]);
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
    setSample([]);
    setResult(null);
  }

  function body(dryRun: boolean) {
    const b: Record<string, unknown> = { table, dryRun };
    if (table === "titles") {
      if (format) b.format = format;
      if (campus) b.campus = campus;
      if (provider) b.provider = provider;
      if (fromYear) b.fromYear = Number(fromYear);
      if (toYear) b.toYear = Number(toYear);
      if (search) b.search = search;
    } else if (table === "subjects") {
      if (programId) b.programId = Number(programId);
      if (search) b.search = search;
    } else {
      if (fromDate) b.fromDate = fromDate;
      if (toDate) b.toDate = toDate;
      if (supplier) b.supplier = supplier;
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
      setSample(j.sample ?? []);
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
      setSample([]);
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
        Choose a table and narrow it down with the filters below, then preview before deleting.
        The preview shows the total count plus the first 10 matching rows so you can check them
        before confirming. Nothing is removed until you confirm.
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
              Provider
              <input
                className="input ml-1 w-32" placeholder="e.g. Perlego" value={provider}
                onChange={(e) => { setProvider(e.target.value); invalidate(); }}
                title="Useful for removing every title from a subscription that's ending, e.g. all Perlego eBooks"
              />
            </label>
            <label className="label">
              Year from
              <input type="number" className="input ml-1 w-24" value={fromYear} onChange={(e) => { setFromYear(e.target.value); invalidate(); }} />
            </label>
            <label className="label">
              Year to
              <input type="number" className="input ml-1 w-24" value={toYear} onChange={(e) => { setToYear(e.target.value); invalidate(); }} />
            </label>
            <label className="label">
              Search (title/author/call no./ISBN)
              <input className="input ml-1 w-56" placeholder="text contains…" value={search} onChange={(e) => { setSearch(e.target.value); invalidate(); }} />
            </label>
          </>
        )}

        {table === "subjects" && (
          <>
            <label className="label">
              Program
              <select className="input ml-1 min-w-[240px]" value={programId} onChange={(e) => { setProgramId(e.target.value); invalidate(); }}>
                <option value="">All programs</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="label">
              Search (code/title)
              <input className="input ml-1 w-56" placeholder="text contains…" value={search} onChange={(e) => { setSearch(e.target.value); invalidate(); }} />
            </label>
          </>
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
            <label className="label">
              Supplier
              <input className="input ml-1 w-56" placeholder="text contains…" value={supplier} onChange={(e) => { setSupplier(e.target.value); invalidate(); }} />
            </label>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-outline text-sm" disabled={busy} onClick={preview}>
          {busy ? "Working…" : "Preview"}
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

      {sample.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              {table === "titles" && (
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-1 pr-2">Title</th><th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Type</th><th className="py-1 pr-2">Campus</th>
                  <th className="py-1 pr-2">Provider</th>
                  <th className="py-1 pr-2">Year</th><th className="py-1 pr-2 text-right">Copies</th>
                </tr>
              )}
              {table === "subjects" && (
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Course Title</th><th className="py-1 pr-2">Program</th>
                </tr>
              )}
              {table === "canvassing" && (
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-1 pr-2">Title</th><th className="py-1 pr-2">Supplier</th>
                  <th className="py-1 pr-2">Canvass Date</th><th className="py-1 pr-2 text-right">Unit Cost</th>
                </tr>
              )}
            </thead>
            <tbody>
              {table === "titles" && (sample as TitleSample[]).map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{r.title}</td><td className="py-1 pr-2">{r.author}</td>
                  <td className="py-1 pr-2">{r.format}</td><td className="py-1 pr-2">{r.campus}</td>
                  <td className="py-1 pr-2">{r.provider}</td>
                  <td className="py-1 pr-2">{r.year}</td><td className="py-1 pr-2 text-right">{r.copies}</td>
                </tr>
              ))}
              {table === "subjects" && (sample as SubjectSample[]).map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{r.course_code}</td><td className="py-1 pr-2">{r.course_title}</td><td className="py-1 pr-2">{r.program}</td>
                </tr>
              ))}
              {table === "canvassing" && (sample as CanvassingSample[]).map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{r.title}</td><td className="py-1 pr-2">{r.supplier}</td>
                  <td className="py-1 pr-2">{r.canvass_date}</td><td className="py-1 pr-2 text-right">{r.unit_cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {previewCount !== null && previewCount > sample.length && (
            <p className="text-xs text-slate-400 mt-1">…and {previewCount - sample.length} more not shown.</p>
          )}
        </div>
      )}

      {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
      {result && <p className="text-green-700 text-sm mt-3">{result}</p>}
    </div>
  );
}
