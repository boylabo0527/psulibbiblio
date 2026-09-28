"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import type { ZeroTitleCampus, ZeroTitleRow } from "@/app/api/reports/zero-title-courses/route";

/** Lists every course that currently has zero VALIDATED (librarian-locked)
 *  titles -- optionally, zero validated titles within a copyright-year
 *  range -- grouped by the campus(es) its program is offered at. A course
 *  with only unreviewed auto-matches still shows up here; it's meant to
 *  flag what needs a librarian's attention next, not just what's totally
 *  untouched. See app/api/reports/zero-title-courses/route.ts for the
 *  exact rules. */
export default function CoverageGapsTab() {
  const { perms } = usePermissions();
  const canView = perms.isAdmin || !!perms.tabs["coverage-gaps"]?.can_view;

  const [campuses, setCampuses] = useState<ZeroTitleCampus[]>([]);
  const [rows, setRows] = useState<ZeroTitleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [minYear, setMinYear] = useState("");
  const [maxYear, setMaxYear] = useState("");
  const [appliedRange, setAppliedRange] = useState<{ min: string; max: string }>({ min: "", max: "" });
  const [campusIds, setCampusIds] = useState<Set<number>>(new Set());

  function load(min: string, max: string) {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (min.trim()) params.set("min_year", min.trim());
    if (max.trim()) params.set("max_year", max.trim());
    const qs = params.toString();
    apiFetch(`/api/reports/zero-title-courses${qs ? `?${qs}` : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setCampuses(j.campuses ?? []);
        setRows(j.rows ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!canView) return;
    load("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  function applyYearFilter() {
    setAppliedRange({ min: minYear, max: maxYear });
    load(minYear, maxYear);
  }
  function clearYearFilter() {
    setMinYear(""); setMaxYear("");
    setAppliedRange({ min: "", max: "" });
    load("", "");
  }

  const visibleRows = useMemo(() => {
    if (campusIds.size === 0) return rows;
    return rows.filter((r) => campusIds.has(r.campus_id));
  }, [rows, campusIds]);

  const sortedRows = useMemo(() =>
    [...visibleRows].sort((a, b) =>
      (a.campus || "￿").localeCompare(b.campus || "￿")
      || a.program.localeCompare(b.program)
      || a.course_code.localeCompare(b.course_code)),
  [visibleRows]);

  function toggleCampus(id: number) {
    setCampusIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function exportXlsx() {
    const XLSX = await import("xlsx");
    const headers = ["Campus", "Program", "Course Code", "Course Title"];
    const dataRows = sortedRows.map((r) => [r.campus || "Unassigned", r.program, r.course_code, r.course_title]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = headers.map((h, i) => ({ wch: Math.max(h.length + 2, i === 3 ? 50 : 20) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Coverage Gaps");
    const suffix = appliedRange.min || appliedRange.max
      ? `_${appliedRange.min || "any"}-${appliedRange.max || "any"}`
      : "";
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `coverage_gaps${suffix}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }

  if (!canView) {
    return <div className="card"><p className="text-slate-500 text-sm">You don&apos;t have access to Coverage Gaps.</p></div>;
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Coverage Gaps</h2>
        <p className="text-xs text-slate-500 mb-4">
          Courses with zero validated (locked) titles, grouped by campus. An unreviewed auto-match doesn&apos;t
          count -- this flags what still needs a librarian to confirm a match, or has none at all. Optionally
          narrow to courses missing anything published within a copyright-year range (older titles they already
          have don&apos;t count toward that range).
        </p>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="text-xs">
            <span className="block text-slate-600 mb-1">Copyright year from</span>
            <input type="number" className="input" style={{ width: 100 }} value={minYear}
              onChange={(e) => setMinYear(e.target.value)} placeholder="e.g. 2020" />
          </label>
          <label className="text-xs">
            <span className="block text-slate-600 mb-1">to</span>
            <input type="number" className="input" style={{ width: 100 }} value={maxYear}
              onChange={(e) => setMaxYear(e.target.value)} placeholder="e.g. 2026" />
          </label>
          <button className="btn" onClick={applyYearFilter} disabled={loading}>Apply</button>
          {(appliedRange.min || appliedRange.max) && (
            <button className="btn-outline" onClick={clearYearFilter} disabled={loading}>Clear</button>
          )}
        </div>
        {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
      </div>

      {!loading && campuses.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-700">Campus ({campusIds.size === 0 ? "all" : campusIds.size} selected)</span>
            {campusIds.size > 0 && <button className="text-[11px] text-psu underline" onClick={() => setCampusIds(new Set())}>Clear</button>}
          </div>
          <div className="border border-slate-200 rounded p-2 max-h-32 overflow-y-auto flex flex-wrap gap-x-4 gap-y-1">
            {campuses.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={campusIds.has(c.id)} onChange={() => toggleCampus(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-psu font-semibold">
            {loading ? "Loading…" : `${sortedRows.length.toLocaleString()} course${sortedRows.length === 1 ? "" : "s"} with a gap`}
          </h2>
          <button className="btn-outline" disabled={loading || sortedRows.length === 0} onClick={exportXlsx}>
            Export XLSX
          </button>
        </div>
        {!loading && sortedRows.length === 0 && !err && (
          <p className="text-slate-500 text-sm">No gaps found{appliedRange.min || appliedRange.max ? " for that year range" : ""}.</p>
        )}
        {!loading && sortedRows.length > 0 && (
          <div className="overflow-x-auto max-h-[32rem] overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 px-2">Campus</th>
                  <th className="py-1 px-2">Program</th>
                  <th className="py-1 px-2">Course Code</th>
                  <th className="py-1 px-2">Course Title</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={`${r.campus_id}-${r.course_id}`} className="border-b border-slate-100">
                    <td className="py-1 px-2 text-slate-500">{r.campus || "Unassigned"}</td>
                    <td className="py-1 px-2 text-slate-500">{r.program}</td>
                    <td className="py-1 px-2">{r.course_code}</td>
                    <td className="py-1 px-2 font-medium">{r.course_title}</td>
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
