"use client";
import { useEffect, useState, useMemo } from "react";
import { RESOURCE_TYPES } from "@/lib/resources";
import type { ResourceTypeId } from "@/lib/resources";
import { useCampuses, useProgramCampusMap } from "@/lib/use-campuses";
import { apiFetch } from "@/lib/api-client";
import type { ProcurementRow } from "@/app/api/procurement/route";
import ProcurementHeatmap from "@/components/ProcurementHeatmap";

const ACCREDITATION_MIN = 5;
const PARTIAL_MIN = 3;
const RECENCY_YEARS = 5;

type Program = { id: number; name: string };
type ViewFilter = "all" | "compliant" | "partial" | "needs";

function statusOf(r: ProcurementRow): "compliant" | "partial" | "outdated" | "needs" {
  if (r.compliant) return "compliant";
  if (r.partial) return "partial";
  if (r.total_titles >= ACCREDITATION_MIN) return "outdated";
  return "needs";
}

export default function ProcurementTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<string | null>(null);
  const [campus, setCampus] = useState("");
  const [view, setView] = useState<ViewFilter>("needs");
  const [rows, setRows] = useState<ProcurementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const cutoffYear = new Date().getFullYear() - RECENCY_YEARS;
  const campuses = useCampuses();
  const { isProgramAtCampus } = useProgramCampusMap();
  const visiblePrograms = campus ? programs.filter(p => isProgramAtCampus(p.id, campus)) : programs;

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
    setLoading(true); setErr(null);
    const p = new URLSearchParams();
    if (programId) p.set("program_id", programId);
    if (campus) p.set("campus", campus);
    apiFetch(`/api/procurement?${p}`)
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setRows(j.rows ?? []); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [programId, campus]);

  // When "All [campus] programs" is selected, filter rows to programs offered at that campus.
  const validProgramIds = campus && !programId
    ? new Set(visiblePrograms.map(p => p.id))
    : null;
  const displayRows = validProgramIds ? rows.filter(r => validProgramIds.has(r.program_id)) : rows;

  const filtered = useMemo(() => {
    if (view === "compliant") return displayRows.filter((r) => r.compliant);
    if (view === "partial") return displayRows.filter((r) => r.partial);
    if (view === "needs") return displayRows.filter((r) => !r.compliant && !r.partial);
    return displayRows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRows, view]);

  const grouped = filtered.reduce<{ program: string; program_id: number; rows: ProcurementRow[] }[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && last.program_id === r.program_id) last.rows.push(r);
    else acc.push({ program: r.program, program_id: r.program_id, rows: [r] });
    return acc;
  }, []);

  const total = displayRows.length;
  const compliantCount = displayRows.filter((r) => r.compliant).length;
  const partialCount = displayRows.filter((r) => r.partial).length;
  const needsCount = total - compliantCount - partialCount;
  const totalGap = displayRows.reduce((a, r) => a + r.gap, 0);
  const complianceRate = total > 0 ? Math.round((compliantCount / total) * 100) : 0;

  const byType = RESOURCE_TYPES.reduce<Record<ResourceTypeId, number>>((acc, rt) => {
    acc[rt.id] = displayRows.reduce((a, r) => a + (r.counts[rt.id] ?? 0), 0);
    return acc;
  }, {} as Record<ResourceTypeId, number>);

  async function exportReport(fmt: "xlsx" | "csv") {
    const XLSX = await import("xlsx");
    const headers = ["Program", "Code", "Subject", "Total Titles", `Recent (${cutoffYear}+)`, "Required", "Gap", "Status"];
    const statusLabel = { compliant: "OK", partial: "Partial", outdated: "Outdated", needs: "Procure" };
    const aoa = [headers, ...filtered.map((r) => [
      r.program, r.course_code, r.course_title, r.total_titles, r.recent_titles,
      ACCREDITATION_MIN, r.gap, statusLabel[statusOf(r)],
    ])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Procurement");
    const buf = XLSX.write(wb, { type: "buffer", bookType: fmt });
    const blob = new Blob([buf], { type: fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" });
    const a = document.createElement("a");
    const scope = programId ? (programs.find((p) => String(p.id) === programId)?.name ?? "program") : (campus || "all_programs");
    a.href = URL.createObjectURL(blob);
    a.download = `procurement_${scope.replace(/[^A-Za-z0-9_-]+/g, "_")}_${view}.${fmt}`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Accreditation Procurement Analysis</h2>
        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-xs text-blue-800">
          <span className="font-semibold">CHED Standard:</span> For each undergraduate program offering, the library shall provide{" "}
          <span className="font-semibold">{ACCREDITATION_MIN} relevant book titles per major subject</span> published{" "}
          <span className="font-semibold">within the last {RECENCY_YEARS} years</span> ({cutoffYear} – present).
          Titles with no publication year or older than {cutoffYear} do not count toward compliance.
          Subjects with at least <span className="font-semibold">{PARTIAL_MIN}</span> recent titles count as partial compliance.
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Program
            <select className="input ml-1 min-w-[240px]" value={programId ?? ""} onChange={(e) => setProgramId(e.target.value)}>
              <option value="">{campus ? `All ${campus} programs` : "All PSU programs"}</option>
              {visiblePrograms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="label">
            Campus
            <select className="input ml-1 min-w-[180px]" value={campus} onChange={(e) => {
              const c = e.target.value;
              setCampus(c);
              if (c && programId) {
                const cur = programs.find(p => String(p.id) === programId);
                if (cur && !isProgramAtCampus(cur.id, c)) {
                  const first = programs.find(p => isProgramAtCampus(p.id, c));
                  setProgramId(first ? String(first.id) : "");
                }
              }
            }}>
              <option value="">All campuses</option>
              {campuses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
        </div>

        {/* Summary cards */}
        {!loading && rows.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <div className="bg-psu-light rounded p-4">
                <div className="text-xs text-slate-600">Total Subjects</div>
                <div className="text-2xl font-semibold text-psu">{total}</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-4">
                <div className="text-xs text-green-700">Compliant</div>
                <div className="text-2xl font-semibold text-green-700">{compliantCount}</div>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                <div className="text-xs text-yellow-700">Partial Compliance</div>
                <div className="text-2xl font-semibold text-yellow-700">{partialCount}</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded p-4">
                <div className="text-xs text-red-700">Needs Procurement</div>
                <div className="text-2xl font-semibold text-red-700">{needsCount}</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-4">
                <div className="text-xs text-amber-700">Recent Titles to Add</div>
                <div className="text-2xl font-semibold text-amber-700">{totalGap}</div>
              </div>
            </div>

            {/* Compliance bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Compliance rate (based on recent titles {cutoffYear}–present)</span>
                <span className="font-semibold">{complianceRate}%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div className="h-2 rounded-full transition-all" style={{
                  width: `${complianceRate}%`,
                  backgroundColor: complianceRate >= 80 ? "#16a34a" : complianceRate >= 50 ? "#d97706" : "#dc2626",
                }} />
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

      {/* Compliance heatmap across campuses */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-psu font-semibold">Compliance Heatmap — Programs Across Campuses</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Compare the same program's compliance across every campus that offers it — useful for
              spotting which branch of a shared program needs procurement attention.
            </p>
          </div>
          <button className="btn-outline text-xs whitespace-nowrap" onClick={() => setShowHeatmap((v) => !v)}>
            {showHeatmap ? "Hide" : "Show"} heatmap
          </button>
        </div>
        {showHeatmap && (
          <div className="mt-3">
            <ProcurementHeatmap />
          </div>
        )}
      </div>

      {/* Subject table */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div>
            <h3 className="text-psu font-semibold">Subject Breakdown</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              "Recent" = titles published {cutoffYear} or later · Gap = titles still needed to reach {ACCREDITATION_MIN}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {([
              { id: "needs",     label: `Needs procurement (${needsCount})` },
              { id: "partial",   label: `Partial (${partialCount})` },
              { id: "compliant", label: `Compliant (${compliantCount})` },
              { id: "all",       label: `All (${total})` },
            ] as { id: ViewFilter; label: string }[]).map((v) => (
              <button key={v.id} onClick={() => setView(v.id)}
                className={"px-3 py-1 rounded border transition " + (view === v.id ? "bg-psu text-white border-psu" : "border-slate-300 text-slate-600 hover:border-slate-400")}>
                {v.label}
              </button>
            ))}
            <button className="btn-outline uppercase ml-2" disabled={filtered.length === 0} onClick={() => exportReport("xlsx")}>
              xlsx
            </button>
            <button className="btn-outline uppercase" disabled={filtered.length === 0} onClick={() => exportReport("csv")}>
              csv
            </button>
          </div>
        </div>

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && rows.length === 0 && <p className="text-slate-500 text-sm">No subjects found. Upload subjects first.</p>}
        {!loading && rows.length > 0 && filtered.length === 0 && <p className="text-slate-500 text-sm">No subjects match this filter.</p>}

        {!loading && grouped.map((grp) => (
          <div key={grp.program_id} className="mb-6">
            {!programId && <h4 className="text-sm font-semibold text-psu mb-1">{grp.program}</h4>}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-1 pr-2 w-24">Code</th>
                    <th className="py-1 pr-2">Subject</th>
                    <th className="py-1 px-2 text-right" title="All titles regardless of year">Total Titles</th>
                    <th className="py-1 px-2 text-right" title={`Titles published ${cutoffYear} or later`}>
                      Recent ({cutoffYear}+)
                    </th>
                    <th className="py-1 px-2 text-right">Required</th>
                    <th className="py-1 px-2 text-right">Gap</th>
                    <th className="py-1 pl-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {grp.rows.map((r) => {
                    const status = statusOf(r);
                    return (
                    <tr key={r.subject_id} className={
                      "border-b border-slate-100 " + (
                        status === "compliant" ? "hover:bg-green-50" :
                        status === "partial" ? "bg-yellow-50/40 hover:bg-yellow-50" :
                        "bg-red-50/40 hover:bg-red-50"
                      )
                    }>
                      <td className="py-1.5 pr-2 text-slate-500">{r.course_code}</td>
                      <td className="py-1.5 pr-2">{r.course_title}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.total_titles}</td>
                      <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{r.recent_titles}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{ACCREDITATION_MIN}</td>
                      <td className={"py-1.5 px-2 text-right font-semibold tabular-nums " + (r.gap > 0 ? "text-red-600" : "text-green-600")}>
                        {r.gap > 0 ? `+${r.gap}` : "—"}
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        {status === "compliant" ? (
                          <span className="inline-block bg-green-100 text-green-700 rounded px-1.5 py-0.5 text-[10px] font-medium">OK</span>
                        ) : status === "partial" ? (
                          <span className="inline-block bg-yellow-100 text-yellow-700 rounded px-1.5 py-0.5 text-[10px] font-medium" title={`Has ${PARTIAL_MIN}-${ACCREDITATION_MIN - 1} recent titles`}>Partial</span>
                        ) : status === "outdated" ? (
                          <span className="inline-block bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 text-[10px] font-medium" title="Has enough titles but they are too old">Outdated</span>
                        ) : (
                          <span className="inline-block bg-red-100 text-red-700 rounded px-1.5 py-0.5 text-[10px] font-medium">Procure</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
