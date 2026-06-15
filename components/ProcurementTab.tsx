"use client";
import { useEffect, useState, useMemo } from "react";
import { RESOURCE_TYPES } from "@/lib/resources";
import type { ResourceTypeId } from "@/lib/resources";
import { PSU_CAMPUSES } from "@/lib/campuses";
import { apiFetch } from "@/lib/api-client";
import type { ProcurementRow } from "@/app/api/procurement/route";

const ACCREDITATION_MIN = 5;

type Program = { id: number; name: string };
type ViewFilter = "all" | "compliant" | "needs";

export default function ProcurementTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<string | null>(null);
  const [campus, setCampus] = useState("");
  const [view, setView] = useState<ViewFilter>("needs");
  const [rows, setRows] = useState<ProcurementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/programs")
      .then((r) => r.json())
      .then((j) => {
        const list: Program[] = j.programs ?? [];
        setPrograms(list);
        setProgramId(list.length > 0 ? String(list[0].id) : "");
      })
      .catch(() => setProgramId(""));
  }, []);

  useEffect(() => {
    if (programId === null) return;
    setLoading(true);
    setErr(null);
    const p = new URLSearchParams();
    if (programId) p.set("program_id", programId);
    if (campus) p.set("campus", campus);
    apiFetch(`/api/procurement?${p}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setErr(j.error);
        else setRows(j.rows ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [programId, campus]);

  const filtered = useMemo(() => {
    if (view === "compliant") return rows.filter((r) => r.compliant);
    if (view === "needs") return rows.filter((r) => !r.compliant);
    return rows;
  }, [rows, view]);

  const grouped = filtered.reduce<{ program: string; program_id: number; rows: ProcurementRow[] }[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && last.program_id === r.program_id) last.rows.push(r);
    else acc.push({ program: r.program, program_id: r.program_id, rows: [r] });
    return acc;
  }, []);

  // Summary stats
  const total = rows.length;
  const compliantCount = rows.filter((r) => r.compliant).length;
  const needsCount = total - compliantCount;
  const totalGap = rows.reduce((a, r) => a + r.gap, 0);
  const complianceRate = total > 0 ? Math.round((compliantCount / total) * 100) : 0;

  // By-type totals for the filtered selection
  const byType = RESOURCE_TYPES.reduce<Record<ResourceTypeId, number>>((acc, rt) => {
    acc[rt.id] = rows.reduce((a, r) => a + (r.counts[rt.id] ?? 0), 0);
    return acc;
  }, {} as Record<ResourceTypeId, number>);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Accreditation Procurement Analysis</h2>
        <p className="text-xs text-slate-500 mb-4">
          CHED accreditation requires at least <strong>{ACCREDITATION_MIN} unique titles</strong> per subject.
          Subjects below this threshold are flagged for procurement.
        </p>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Program
            <select className="input ml-1 min-w-[240px]" value={programId ?? ""} onChange={(e) => setProgramId(e.target.value)}>
              <option value="">All programs</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="label">
            Campus
            <select className="input ml-1 min-w-[180px]" value={campus} onChange={(e) => setCampus(e.target.value)}>
              <option value="">All campuses</option>
              {PSU_CAMPUSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {/* Summary cards */}
        {!loading && rows.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-psu-light rounded p-4">
                <div className="text-xs text-slate-600">Total Subjects</div>
                <div className="text-2xl font-semibold text-psu">{total}</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-4">
                <div className="text-xs text-green-700">Compliant</div>
                <div className="text-2xl font-semibold text-green-700">{compliantCount}</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded p-4">
                <div className="text-xs text-red-700">Needs Procurement</div>
                <div className="text-2xl font-semibold text-red-700">{needsCount}</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-4">
                <div className="text-xs text-amber-700">Titles to Procure</div>
                <div className="text-2xl font-semibold text-amber-700">{totalGap}</div>
              </div>
            </div>

            {/* Compliance bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Compliance rate</span>
                <span className="font-semibold">{complianceRate}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${complianceRate}%`,
                    backgroundColor: complianceRate >= 80 ? "#16a34a" : complianceRate >= 50 ? "#d97706" : "#dc2626",
                  }}
                />
              </div>
            </div>

            {/* Per-type breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {RESOURCE_TYPES.map((rt) => (
                <div key={rt.id} className="bg-slate-50 border border-slate-200 rounded p-2">
                  <div className="text-xs text-slate-500">{rt.uiLabel}</div>
                  <div className="text-lg font-semibold text-psu">{(byType[rt.id] ?? 0).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Subject table */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-psu font-semibold">Subject Breakdown</h3>
          <div className="flex gap-1 text-xs">
            {([
              { id: "needs",     label: `Needs procurement (${needsCount})` },
              { id: "compliant", label: `Compliant (${compliantCount})` },
              { id: "all",       label: `All (${total})` },
            ] as { id: ViewFilter; label: string }[]).map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={
                  "px-3 py-1 rounded border transition " +
                  (view === v.id
                    ? "bg-psu text-white border-psu"
                    : "border-slate-300 text-slate-600 hover:border-slate-400")
                }
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-slate-500 text-sm">No subjects found. Upload subjects first.</p>
        )}
        {!loading && rows.length > 0 && filtered.length === 0 && (
          <p className="text-slate-500 text-sm">No subjects match this filter.</p>
        )}

        {!loading && grouped.map((grp) => (
          <div key={grp.program_id} className="mb-6">
            {!programId && (
              <h4 className="text-sm font-semibold text-psu mb-1">{grp.program}</h4>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-1 pr-2 w-24">Code</th>
                    <th className="py-1 pr-2">Subject</th>
                    <th className="py-1 px-2 text-right">Titles</th>
                    <th className="py-1 px-2 text-right">Volumes</th>
                    <th className="py-1 px-2 text-right">Required</th>
                    <th className="py-1 pl-2 text-right">Gap</th>
                    <th className="py-1 pl-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {grp.rows.map((r) => (
                    <tr key={r.subject_id} className={
                      "border-b border-slate-100 " +
                      (r.compliant ? "hover:bg-green-50" : "bg-red-50/40 hover:bg-red-50")
                    }>
                      <td className="py-1.5 pr-2 text-slate-500">{r.course_code}</td>
                      <td className="py-1.5 pr-2">{r.course_title}</td>
                      <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{r.total_titles}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{r.total_volumes}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{ACCREDITATION_MIN}</td>
                      <td className={
                        "py-1.5 pl-2 text-right font-semibold tabular-nums " +
                        (r.gap > 0 ? "text-red-600" : "text-green-600")
                      }>
                        {r.gap > 0 ? `+${r.gap}` : "—"}
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        {r.compliant ? (
                          <span className="inline-block bg-green-100 text-green-700 rounded px-1.5 py-0.5 text-[10px] font-medium">OK</span>
                        ) : (
                          <span className="inline-block bg-red-100 text-red-700 rounded px-1.5 py-0.5 text-[10px] font-medium">Procure</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
