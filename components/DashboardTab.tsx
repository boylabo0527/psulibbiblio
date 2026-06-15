"use client";
import { useEffect, useState } from "react";
import { RESOURCE_TYPES } from "@/lib/resources";
import type { ResourceTypeId } from "@/lib/resources";
import { PSU_CAMPUSES } from "@/lib/campuses";
import { isProgramAtCampus } from "@/lib/campus-program-map";
import { apiFetch } from "@/lib/api-client";
import type { SubjectSummaryRow } from "@/app/api/dashboard/subjects/route";

type Program = { id: number; name: string };

const CITATION_STYLES = [
  { value: "apa7", label: "APA 7" },
  { value: "mla9", label: "MLA 9" },
  { value: "chicago", label: "Chicago" },
  { value: "harvard", label: "Harvard" },
];

export default function DashboardTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  // null = programs not yet loaded (prevents fetching all subjects before preselection)
  const [programId, setProgramId] = useState<string | null>(null);
  const [campus, setCampus] = useState<string>("");
  const [citationStyle, setCitationStyle] = useState("apa7");
  const [subjects, setSubjects] = useState<SubjectSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Fetch program list once; pre-select first program.
  useEffect(() => {
    apiFetch("/api/programs")
      .then((r) => r.json())
      .then((j) => {
        const list: Program[] = j.programs ?? [];
        setPrograms(list);
        setProgramId(list.length > 0 ? String(list[0].id) : "");
      })
      .catch(() => { setProgramId(""); });
  }, []);

  // When campus changes, reset program to the first one offered at that campus.
  const visiblePrograms = campus
    ? programs.filter(p => isProgramAtCampus(p.name, campus))
    : programs;

  // Fetch per-subject counts whenever filters change (skip until programs loaded).
  useEffect(() => {
    if (programId === null) return;
    setLoading(true);
    setErr(null);
    const p = new URLSearchParams();
    if (programId) p.set("program_id", programId);
    if (campus) p.set("campus", campus);
    apiFetch(`/api/dashboard/subjects?${p}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setErr(j.error);
        else setSubjects(j.subjects ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [programId, campus]);

  // Derive summary totals from the filtered subjects data.
  // When "All [campus] programs" is selected (programId=""), limit to programs offered at that campus.
  const validProgramIds = campus && !programId
    ? new Set(visiblePrograms.map(p => p.id))
    : null;
  const displaySubjects = validProgramIds
    ? subjects.filter(s => validProgramIds.has(s.program_id))
    : subjects;

  const summaryPrograms = new Set(displaySubjects.map((s) => s.program_id)).size;
  const summarySubjects = displaySubjects.length;
  const summaryTitles = displaySubjects.reduce((a, s) => a + s.total_titles, 0);
  const summaryVolumes = displaySubjects.reduce((a, s) => a + s.total_volumes, 0);
  const byType = RESOURCE_TYPES.reduce<Record<ResourceTypeId, number>>((acc, rt) => {
    acc[rt.id] = displaySubjects.reduce((a, s) => a + (s.counts[rt.id] ?? 0), 0);
    return acc;
  }, {} as Record<ResourceTypeId, number>);

  async function exportCitations(
    fmt: "citations-docx" | "citations-txt",
    subjectId?: number,
    subjectLabel?: string,
    subjectProgramId?: number,
  ) {
    const pid = subjectProgramId ? String(subjectProgramId) : programId;
    if (!pid) return;
    setExporting(true);
    try {
      const p = new URLSearchParams({ program_id: pid, fmt, style: citationStyle });
      if (campus) p.set("campus", campus);
      if (subjectId) { p.set("subject_id", String(subjectId)); p.set("subject_label", subjectLabel ?? ""); }
      const res = await apiFetch(`/api/export?${p}`);
      if (!res.ok) { setErr(await res.text()); return; }
      const blob = await res.blob();
      const baseName = subjectLabel
        ? subjectLabel.replace(/[^A-Za-z0-9_-]+/g, "_")
        : (programs.find((p) => String(p.id) === pid)?.name ?? "program").replace(/[^A-Za-z0-9_-]+/g, "_");
      const ext = fmt === "citations-docx" ? "docx" : "txt";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${baseName}_citations.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  // Group subjects by program for display.
  const grouped = displaySubjects.reduce<{ program: string; program_id: number; rows: SubjectSummaryRow[] }[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last.program_id === s.program_id) last.rows.push(s);
    else acc.push({ program: s.program, program_id: s.program_id, rows: [s] });
    return acc;
  }, []);

  return (
    <>
      {/* Summary — computed from filtered subjects, updates with filters */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-3">
          Summary
          {(programId || campus) && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              {[programId && programs.find((p) => String(p.id) === programId)?.name, campus].filter(Boolean).join(" · ")}
            </span>
          )}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            { label: "Programs", value: summaryPrograms },
            { label: "Subjects", value: summarySubjects },
            { label: "Total Titles", value: summaryTitles },
            { label: "Total Volumes", value: summaryVolumes },
          ].map((s) => (
            <div key={s.label} className="bg-psu-light rounded p-4">
              <div className="text-xs text-slate-600">{s.label}</div>
              <div className="text-2xl font-semibold text-psu">{s.value.toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {RESOURCE_TYPES.map((rt) => (
            <div key={rt.id} className="bg-slate-50 border border-slate-200 rounded p-3">
              <div className="text-xs text-slate-600">{rt.uiLabel}</div>
              <div className="text-xl font-semibold text-psu">{(byType[rt.id] ?? 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters + per-subject table */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-3">Titles per Subject</h2>

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
              // If current program is not offered at the new campus, switch to first available
              if (c && programId) {
                const cur = programs.find(p => String(p.id) === programId);
                if (cur && !isProgramAtCampus(cur.name, c)) {
                  const first = programs.find(p => isProgramAtCampus(p.name, c));
                  setProgramId(first ? String(first.id) : "");
                }
              }
            }}>
              <option value="">All campuses</option>
              {PSU_CAMPUSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {/* Citation export (requires a program selected) */}
        {programId && (
          <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-slate-50 rounded">
            <span className="text-sm text-slate-600">Export citations:</span>
            <select className="input text-xs" value={citationStyle} onChange={(e) => setCitationStyle(e.target.value)}>
              {CITATION_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="btn-outline text-xs uppercase" disabled={exporting} onClick={() => exportCitations("citations-docx")}>
              DOCX
            </button>
            <button className="btn-outline text-xs uppercase" disabled={exporting} onClick={() => exportCitations("citations-txt")}>
              TXT
            </button>
            {campus && <span className="text-xs text-slate-500">Printed titles filtered to {campus}</span>}
          </div>
        )}

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}

        {!loading && displaySubjects.length === 0 && (
          <p className="text-slate-500 text-sm">No subjects found. Upload subjects first.</p>
        )}

        {!loading && grouped.length > 0 && (
          <>
            {grouped.map((grp) => (
              <div key={grp.program_id} className="mb-6">
                {!programId && (
                  <h3 className="text-sm font-semibold text-psu mb-1">{grp.program}</h3>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 text-left">
                        <th className="py-1 pr-2 w-24">Code</th>
                        <th className="py-1 pr-2">Subject</th>
                        <th className="py-1 px-2 text-right">Titles</th>
                        <th className="py-1 px-2 text-right">Volumes</th>
                        <th className="py-1 pl-2 w-24 text-right">Citation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.rows.map((s) => {
                        const label = [s.course_code, s.course_title].filter(Boolean).join("_");
                        return (
                          <tr key={s.subject_id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-1.5 pr-2 text-slate-500">{s.course_code}</td>
                            <td className="py-1.5 pr-2">{s.course_title}</td>
                            <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{s.total_titles}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{s.total_volumes}</td>
                            <td className="py-1.5 pl-2 text-right">
                              <button
                                className="text-psu text-[11px] underline whitespace-nowrap disabled:opacity-30"
                                disabled={exporting || s.total_titles === 0}
                                onClick={() => exportCitations("citations-docx", s.subject_id, label, s.program_id)}
                                title={`Download ${citationStyle.toUpperCase()} citation list`}
                              >
                                Export
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-6 text-xs font-semibold text-psu mt-2 pt-2 border-t border-slate-200">
              <span>{displaySubjects.length} subjects</span>
              <span>{summaryTitles.toLocaleString()} titles</span>
              <span>{summaryVolumes.toLocaleString()} volumes</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
