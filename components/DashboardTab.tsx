"use client";
import { useEffect, useState } from "react";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";
import { PSU_CAMPUSES } from "@/lib/campuses";
import { apiFetch } from "@/lib/api-client";
import type { SubjectSummaryRow } from "@/app/api/dashboard/subjects/route";

type Totals = {
  programs: number; subjects: number; titles: number; assignments: number;
  byType: Record<ResourceTypeId, number>;
};
type Program = { id: number; name: string };

const CITATION_STYLES = [
  { value: "apa7", label: "APA 7" },
  { value: "mla9", label: "MLA 9" },
  { value: "chicago", label: "Chicago" },
  { value: "harvard", label: "Harvard" },
];

export default function DashboardTab() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<string>("");
  const [campus, setCampus] = useState<string>("");
  const [citationStyle, setCitationStyle] = useState("apa7");
  const [subjects, setSubjects] = useState<SubjectSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Fetch global totals and program list once; pre-select first program.
  useEffect(() => {
    apiFetch("/api/dashboard")
      .then((r) => r.json())
      .then((j) => { if (j.totals) setTotals(j.totals); })
      .catch(() => {});
    apiFetch("/api/programs")
      .then((r) => r.json())
      .then((j) => {
        const list: Program[] = j.programs ?? [];
        setPrograms(list);
        if (list.length > 0) setProgramId(String(list[0].id));
      })
      .catch(() => {});
  }, []);

  // Fetch per-subject counts whenever filters change.
  useEffect(() => {
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

  async function exportCitations(
    fmt: "citations-docx" | "citations-txt",
    subjectId?: number,
    subjectLabel?: string,
  ) {
    if (!programId) return;
    setExporting(true);
    try {
      const p = new URLSearchParams({ program_id: programId, fmt, style: citationStyle });
      if (campus) p.set("campus", campus);
      if (subjectId) { p.set("subject_id", String(subjectId)); p.set("subject_label", subjectLabel ?? ""); }
      const res = await apiFetch(`/api/export?${p}`);
      if (!res.ok) { setErr(await res.text()); return; }
      const blob = await res.blob();
      const prog = programs.find((p) => String(p.id) === programId);
      const baseName = subjectLabel
        ? subjectLabel.replace(/[^A-Za-z0-9_-]+/g, "_")
        : (prog?.name ?? "program").replace(/[^A-Za-z0-9_-]+/g, "_");
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
  const grouped = subjects.reduce<{ program: string; program_id: number; rows: SubjectSummaryRow[] }[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last.program_id === s.program_id) last.rows.push(s);
    else acc.push({ program: s.program, program_id: s.program_id, rows: [s] });
    return acc;
  }, []);

  const totalTitles = subjects.reduce((a, s) => a + s.total_titles, 0);
  const totalVolumes = subjects.reduce((a, s) => a + s.total_volumes, 0);

  return (
    <>
      {/* Global totals */}
      {totals && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-3">Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Programs", value: totals.programs },
              { label: "Subjects", value: totals.subjects },
              { label: "Total Titles", value: totals.titles },
              { label: "Assignments", value: totals.assignments },
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
                <div className="text-xl font-semibold text-psu">{(totals.byType?.[rt.id] ?? 0).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + per-subject table */}
      <div className="card">
        <h2 className="text-psu font-semibold mb-3">Titles per Subject</h2>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Program
            <select className="input ml-1 min-w-[240px]" value={programId} onChange={(e) => setProgramId(e.target.value)}>
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

        {!loading && subjects.length === 0 && (
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
                        {RESOURCE_TYPES.map((rt) => (
                          <th key={rt.id} className="py-1 px-1 text-right whitespace-nowrap" title={rt.uiLabel}>
                            {rt.sectionLabel.split(" ").slice(-1)[0]}
                          </th>
                        ))}
                        <th className="py-1 pl-2 text-right font-semibold">Titles</th>
                        <th className="py-1 pl-1 text-right font-semibold">Vols</th>
                        <th className="py-1 pl-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.rows.map((s) => {
                        const label = [s.course_code, s.course_title].filter(Boolean).join("_");
                        return (
                        <tr key={s.subject_id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-1 pr-2 text-slate-500">{s.course_code}</td>
                          <td className="py-1 pr-2">{s.course_title}</td>
                          {RESOURCE_TYPES.map((rt) => (
                            <td key={rt.id} className="py-1 px-1 text-right tabular-nums">
                              {s.counts[rt.id] ? s.counts[rt.id] : <span className="text-slate-300">—</span>}
                            </td>
                          ))}
                          <td className="py-1 pl-2 text-right font-semibold tabular-nums">{s.total_titles}</td>
                          <td className="py-1 pl-1 text-right tabular-nums text-slate-600">{s.total_volumes}</td>
                          <td className="py-1 pl-2">
                            <button
                              className="text-psu text-[10px] underline whitespace-nowrap disabled:opacity-40"
                              disabled={exporting || s.total_titles === 0}
                              onClick={() => exportCitations("citations-docx", s.subject_id, label)}
                              title={`Export ${citationStyle.toUpperCase()} citations for this subject`}
                            >
                              cite
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
              <span>{subjects.length} subjects</span>
              <span>{totalTitles.toLocaleString()} titles</span>
              <span>{totalVolumes.toLocaleString()} volumes</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
