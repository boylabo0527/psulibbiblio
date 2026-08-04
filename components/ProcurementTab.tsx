"use client";
import { useEffect, useState, useMemo } from "react";
import { RESOURCE_TYPES } from "@/lib/resources";
import type { ResourceTypeId } from "@/lib/resources";
import { useCampuses, useProgramCampusMap } from "@/lib/use-campuses";
import { apiFetch } from "@/lib/api-client";
import type { ProcurementRow } from "@/app/api/procurement/route";
import ProcurementHeatmap from "@/components/ProcurementHeatmap";
import ProgramJournalsPanel from "@/components/ProgramJournalsPanel";
import { ACCREDITATION_MIN, PARTIAL_MIN, RECENCY_YEARS, MIN_PRINTED_BOOKS } from "@/lib/compliance";

type Program = { id: number; name: string; cost_per_title: number | null };
type ViewFilter = "all" | "compliant" | "partial" | "needs";

function money(n: number): string {
  return "₱" + Math.round(n).toLocaleString();
}

function statusOf(r: ProcurementRow): "compliant" | "needs_printed" | "partial" | "outdated" | "needs" {
  if (r.compliant) return "compliant";
  // Enough recent titles overall, just missing the printed-book requirement
  // specifically -- a narrower, more actionable case than generic "partial".
  if (r.recent_titles >= ACCREDITATION_MIN) return "needs_printed";
  if (r.partial) return "partial";
  if (r.total_titles >= ACCREDITATION_MIN) return "outdated";
  return "needs";
}

/** Splits a subject's per-format counts into printed vs. digital/eBook,
 *  using each resource type's `medium` (print | digital). */
function mediumBreakdown(counts: Record<ResourceTypeId, number>): { printed: number; digital: number } {
  let printed = 0, digital = 0;
  for (const rt of RESOURCE_TYPES) {
    const c = counts[rt.id] ?? 0;
    if (rt.medium === "print") printed += c;
    else digital += c;
  }
  return { printed, digital };
}

export default function ProcurementTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<string | null>(null);
  const [campus, setCampus] = useState("");
  const [view, setView] = useState<ViewFilter>("needs");
  const [rows, setRows] = useState<ProcurementRow[]>([]);
  const [loading, setLoading] = useState(true); // true only until the very first fetch resolves
  const [refreshing, setRefreshing] = useState(false); // true for every fetch after that
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

  // Program is deliberately not a fetch dependency -- it's a pure
  // client-side filter over the same campus-scoped dataset (see
  // displayRows below), so switching programs is instant instead of
  // round-tripping the network. Campus still refetches since printed
  // copies are campus-scoped and genuinely change the server-side
  // compliance computation. `loading` only gates the very first fetch;
  // later campus changes keep the current table visible with a small
  // "Updating…" note instead of blanking it.
  function loadRows() {
    if (programId === null) return;
    setRefreshing(true); setErr(null);
    const p = new URLSearchParams();
    if (campus) p.set("campus", campus);
    apiFetch(`/api/procurement?${p}`)
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setRows(j.rows ?? []); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => { setRefreshing(false); setLoading(false); });
  }

  // `programId !== null` (not programId itself) so this fires once the
  // initial /api/programs fetch resolves, but never again on later program
  // switches -- only a real campus change re-triggers the network fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadRows, [campus, programId !== null]);

  // When "All [campus] programs" is selected, filter rows to programs
  // offered at that campus; a specific program is always a client-side filter.
  const validProgramIds = campus
    ? new Set(visiblePrograms.map(p => p.id))
    : null;
  const programScoped = programId ? rows.filter(r => String(r.program_id) === programId) : rows;
  const displayRows = validProgramIds ? programScoped.filter(r => validProgramIds.has(r.program_id)) : programScoped;

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
  const totalPrinted = RESOURCE_TYPES.filter((rt) => rt.medium === "print").reduce((a, rt) => a + (byType[rt.id] ?? 0), 0);
  const totalDigital = RESOURCE_TYPES.filter((rt) => rt.medium === "digital").reduce((a, rt) => a + (byType[rt.id] ?? 0), 0);

  const needingProcurement = displayRows.filter((r) => r.gap > 0);
  const totalEstimatedCost = needingProcurement.reduce((a, r) => a + (r.estimated_cost ?? 0), 0);
  const missingEstimateCount = needingProcurement.filter((r) => r.cost_per_title == null).length;

  async function exportReport(fmt: "xlsx" | "csv") {
    const XLSX = await import("xlsx");
    const headers = ["Program", "Code", "Subject", "Total Titles", "Printed", "Digital/eBook", `Recent (${cutoffYear}+)`, "Recent Printed", "Required", "Min. Printed", "Gap", "Est. Cost/Title", "Est. Cost", "Status"];
    const statusLabel = { compliant: "OK", needs_printed: "Needs Printed", partial: "Partial", outdated: "Outdated", needs: "Procure" };
    const aoa = [headers, ...filtered.map((r) => {
      const { printed, digital } = mediumBreakdown(r.counts);
      return [
        r.program, r.course_code, r.course_title, r.total_titles, printed, digital, r.recent_titles, r.recent_printed_titles,
        ACCREDITATION_MIN, MIN_PRINTED_BOOKS, r.gap, r.cost_per_title ?? "", r.estimated_cost ?? "", statusLabel[statusOf(r)],
      ];
    })];
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
          <span className="font-semibold">{ACCREDITATION_MIN} relevant book titles per major subject</span> (printed and eBook
          combined, journals excluded) published <span className="font-semibold">within the last {RECENCY_YEARS} years</span> ({cutoffYear} – present),
          including <span className="font-semibold">at least {MIN_PRINTED_BOOKS} recent printed book</span> -- {ACCREDITATION_MIN} recent
          eBooks alone is not compliant. Titles with no publication year or older than {cutoffYear} do not count toward compliance.
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
          {programId && (
            <ProgramCostEditor
              program={programs.find((p) => String(p.id) === programId) ?? null}
              onSaved={(updated) => {
                setPrograms((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                loadRows();
              }}
            />
          )}
          {!programId && campus && visiblePrograms.length > 0 && (
            <BulkCampusCostEditor
              campus={campus}
              programs={visiblePrograms}
              onSaved={(updated) => {
                const byId = new Map(updated.map((p) => [p.id, p]));
                setPrograms((prev) => prev.map((p) => byId.get(p.id) ?? p));
                loadRows();
              }}
            />
          )}
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

            {/* Printed vs. digital breakdown */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-slate-50 border border-slate-200 rounded p-2">
                <div className="text-xs text-slate-500">Printed (books + journals)</div>
                <div className="text-lg font-semibold text-psu">{totalPrinted.toLocaleString()}</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded p-2">
                <div className="text-xs text-slate-500">Digital/eBook (eBooks, online journals, repository)</div>
                <div className="text-lg font-semibold text-psu">{totalDigital.toLocaleString()}</div>
              </div>
            </div>

            {/* Estimated procurement cost */}
            <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-2">
              <div className="text-xs text-amber-700">Estimated Procurement Cost</div>
              <div className="text-xl font-semibold text-amber-700">{money(totalEstimatedCost)}</div>
              <p className="text-[11px] text-amber-700 mt-1">
                {needingProcurement.length} subject{needingProcurement.length === 1 ? "" : "s"} need title(s).
                {missingEstimateCount > 0 && ` ${missingEstimateCount} of them have no cost-per-title estimate set yet, so this total is understated — set a program default above or per-subject below.`}
              </p>
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

      {programId && <ProgramJournalsPanel programId={programId} campus={campus} />}

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
              "Recent" = titles published {cutoffYear} or later · Gap = titles still needed to reach {ACCREDITATION_MIN} total
              with at least {MIN_PRINTED_BOOKS} printed
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
        {!loading && refreshing && <p className="text-slate-400 text-xs mb-2">Updating…</p>}
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
                    <th className="py-1 px-2 text-right" title="Printed books and journals">Printed</th>
                    <th className="py-1 px-2 text-right" title="eBooks, online journals, and institutional repository items">Digital/eBook</th>
                    <th className="py-1 px-2 text-right" title={`Titles published ${cutoffYear} or later (printed + eBook, journals excluded)`}>
                      Recent ({cutoffYear}+)
                    </th>
                    <th className="py-1 px-2 text-right" title={`Of those, how many are a printed book -- at least ${MIN_PRINTED_BOOKS} required`}>
                      Recent Printed
                    </th>
                    <th className="py-1 px-2 text-right">Required</th>
                    <th className="py-1 px-2 text-right">Gap</th>
                    <th className="py-1 px-2 text-right" title="Overrides the program default for just this subject">Est. Cost/Title</th>
                    <th className="py-1 px-2 text-right">Est. Cost</th>
                    <th className="py-1 pl-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {grp.rows.map((r) => {
                    const status = statusOf(r);
                    const { printed, digital } = mediumBreakdown(r.counts);
                    return (
                    <tr key={r.subject_id} className={
                      "border-b border-slate-100 " + (
                        status === "compliant" ? "hover:bg-green-50" :
                        status === "needs_printed" ? "bg-amber-50/40 hover:bg-amber-50" :
                        status === "partial" ? "bg-yellow-50/40 hover:bg-yellow-50" :
                        "bg-red-50/40 hover:bg-red-50"
                      )
                    }>
                      <td className="py-1.5 pr-2 text-slate-500">{r.course_code}</td>
                      <td className="py-1.5 pr-2">{r.course_title}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.total_titles}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{printed}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{digital}</td>
                      <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{r.recent_titles}</td>
                      <td className={"py-1.5 px-2 text-right font-semibold tabular-nums " + (r.recent_printed_titles < MIN_PRINTED_BOOKS ? "text-amber-600" : "")}>
                        {r.recent_printed_titles}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{ACCREDITATION_MIN}</td>
                      <td className={"py-1.5 px-2 text-right font-semibold tabular-nums " + (r.gap > 0 ? "text-red-600" : "text-green-600")}>
                        {r.gap > 0 ? `+${r.gap}` : "—"}
                        {r.gap > 0 && r.pending_titles > 0 && (
                          <div className="text-[10px] font-normal text-amber-600" title="Already canvassed and on an active Purchase Request or Purchase Order, just not catalogued yet -- don't re-request these.">
                            {Math.min(r.pending_titles, r.gap)} already ordered
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        <SubjectCostInput subjectId={r.subject_id} value={r.cost_per_title} onSaved={loadRows} />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">
                        {r.estimated_cost != null ? money(r.estimated_cost) : "—"}
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        {status === "compliant" ? (
                          <span className="inline-block bg-green-100 text-green-700 rounded px-1.5 py-0.5 text-[10px] font-medium">OK</span>
                        ) : status === "needs_printed" ? (
                          <span className="inline-block bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 text-[10px] font-medium" title={`Has ${ACCREDITATION_MIN}+ recent titles but no recent printed book`}>Needs Printed</span>
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

/** Edits a program's default cost-per-title estimate (/api/programs/:id).
 *  Falls back to nothing set (blank) if the program has no estimate yet. */
function ProgramCostEditor({
  program, onSaved,
}: {
  program: Program | null;
  onSaved: (updated: Program) => void;
}) {
  const [draft, setDraft] = useState(program?.cost_per_title != null ? String(program.cost_per_title) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(program?.cost_per_title != null ? String(program.cost_per_title) : "");
  }, [program?.id, program?.cost_per_title]);

  async function save() {
    if (!program) return;
    const value = draft.trim() === "" ? null : Number(draft);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setErr("Enter a valid non-negative number");
      return;
    }
    if (value === (program.cost_per_title ?? null)) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/programs/${program.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cost_per_title: value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onSaved(j.program);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="label">
      Default cost/title (₱)
      <input
        type="number" min={0} step="0.01" className="input ml-1 w-28"
        placeholder="e.g. 1500"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
      />
      {err && <span className="text-red-700 text-xs ml-2">{err}</span>}
    </label>
  );
}

/** Sets the same default cost-per-title across every program offered at one
 *  campus in one action -- shown instead of ProgramCostEditor when "All
 *  [campus] programs" is selected, since there's no single program to edit
 *  but budgeting is still naturally done per campus. PATCHes each visible
 *  program individually and reports back the updated rows. */
function BulkCampusCostEditor({
  campus, programs, onSaved,
}: {
  campus: string;
  programs: Program[];
  onSaved: (updated: Program[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function apply() {
    const value = draft.trim() === "" ? null : Number(draft);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setErr("Enter a valid non-negative number");
      return;
    }
    if (!confirm(`Set the default cost/title to ${value ?? "unset"} for all ${programs.length} programs offered at ${campus}?`)) return;
    setSaving(true);
    setErr(null);
    try {
      const updated = await Promise.all(programs.map(async (p) => {
        const res = await apiFetch(`/api/programs/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cost_per_title: value }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        return j.program as Program;
      }));
      setDraft("");
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="label">
      Set cost/title (₱) for all {programs.length} {campus} programs
      <input
        type="number" min={0} step="0.01" className="input ml-1 w-28"
        placeholder="e.g. 1500"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="btn-outline text-xs ml-2" disabled={saving || draft.trim() === ""} onClick={apply}>
        {saving ? "Applying…" : "Apply to all"}
      </button>
      {err && <span className="text-red-700 text-xs ml-2">{err}</span>}
    </label>
  );
}

/** Overrides the cost-per-title estimate for one subject specifically
 *  (/api/subjects/:id). `value` is the already-resolved figure (subject's
 *  own override if set, else the program default), shown as the starting
 *  point -- saving here always writes an explicit subject-level override. */
function SubjectCostInput({
  subjectId, value, onSaved,
}: {
  subjectId: number;
  value: number | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value != null ? String(value) : "");
  }, [subjectId, value]);

  async function save() {
    const newValue = draft.trim() === "" ? null : Number(draft);
    if (newValue !== null && (!Number.isFinite(newValue) || newValue < 0)) return;
    if (newValue === (value ?? null)) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cost_per_title: newValue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved();
    } catch {
      setDraft(value != null ? String(value) : ""); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="number" min={0} step="0.01" className="input w-24 text-right text-xs py-0.5"
      placeholder="—"
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
    />
  );
}
