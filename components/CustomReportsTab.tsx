"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import type { ReportCampus, ReportProgram, ReportCourse } from "@/app/api/reports/courses/route";

/** Lets an admin build a course-listing report (campus, program, course
 *  code/title, description) scoped to whatever combination of campuses and
 *  programs they pick -- an empty selection on either axis means "all",
 *  narrowing only happens when something is actually checked. Individual
 *  course rows can be excluded from the final export too, the same
 *  select/exclude pattern as the TOR generator's item list. */
export default function CustomReportsTab() {
  const { perms } = usePermissions();
  const canView = perms.isAdmin || !!perms.tabs["reports"]?.can_view;

  const [campuses, setCampuses] = useState<ReportCampus[]>([]);
  const [programs, setPrograms] = useState<ReportProgram[]>([]);
  const [courses, setCourses] = useState<ReportCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [campusIds, setCampusIds] = useState<Set<number>>(new Set());
  const [programIds, setProgramIds] = useState<Set<number>>(new Set());
  const [excludedCourseIds, setExcludedCourseIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    apiFetch("/api/reports/courses")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setCampuses(j.campuses ?? []);
        setPrograms(j.programs ?? []);
        setCourses(j.courses ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [canView]);

  const programMap = useMemo(() => new Map(programs.map((p) => [p.id, p])), [programs]);
  const campusMap = useMemo(() => new Map(campuses.map((c) => [c.id, c.name])), [campuses]);

  // Programs narrow to the selected campuses (if any); "offered nowhere"
  // (no program_campuses mapping yet) stays visible rather than
  // disappearing, same policy used everywhere else campus scope is read.
  const visiblePrograms = useMemo(() => {
    if (campusIds.size === 0) return programs;
    return programs.filter((p) => p.campus_ids.length === 0 || p.campus_ids.some((id) => campusIds.has(id)));
  }, [programs, campusIds]);

  const visibleCourses = useMemo(() => {
    const programScope = programIds.size > 0 ? programIds : new Set(visiblePrograms.map((p) => p.id));
    return courses.filter((c) => programScope.has(c.program_id));
  }, [courses, programIds, visiblePrograms]);

  const includedCourses = visibleCourses.filter((c) => !excludedCourseIds.has(c.id));

  function toggleCampus(id: number) {
    setCampusIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleProgram(id: number) {
    setProgramIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleCourse(id: number) {
    setExcludedCourseIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function courseRowLabel(course: ReportCourse) {
    const program = programMap.get(course.program_id);
    const campusNames = program ? program.campus_ids.map((id) => campusMap.get(id)).filter(Boolean) as string[] : [];
    return { program: program?.name ?? "", campuses: campusNames.join(", ") || "—" };
  }

  async function exportFile(fmt: "xlsx" | "csv") {
    const XLSX = await import("xlsx");
    const headers = ["Campus(es)", "Program", "Course Code", "Course Title", "Description"];
    const rows = includedCourses.map((c) => {
      const { program, campuses: campusList } = courseRowLabel(c);
      return [campusList, program, c.course_code, c.course_title, c.description];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = headers.map((h, i) => ({ wch: Math.max(h.length + 2, i === 4 ? 40 : 16) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Courses");
    const buf = XLSX.write(wb, { type: "buffer", bookType: fmt });
    const blob = new Blob([buf], { type: fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `course_report.${fmt}`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }

  if (!canView) {
    return <div className="card"><p className="text-slate-500 text-sm">You don&apos;t have access to Custom Reports.</p></div>;
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Custom Course Report</h2>
        <p className="text-xs text-slate-500 mb-4">
          Build a campus/program/course listing and export it as XLSX or CSV. Leave Campus and/or Program unchecked
          to include all of them -- checking any narrows to just those.
        </p>
        {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700">Campus ({campusIds.size === 0 ? "all" : campusIds.size} selected)</span>
                {campusIds.size > 0 && <button className="text-[11px] text-psu underline" onClick={() => setCampusIds(new Set())}>Clear</button>}
              </div>
              <div className="border border-slate-200 rounded p-2 max-h-40 overflow-y-auto space-y-1">
                {campuses.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={campusIds.has(c.id)} onChange={() => toggleCampus(c.id)} />
                    {c.name}
                  </label>
                ))}
                {campuses.length === 0 && <p className="text-xs text-slate-400">No campuses configured.</p>}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700">Program ({programIds.size === 0 ? "all" : programIds.size} selected)</span>
                {programIds.size > 0 && <button className="text-[11px] text-psu underline" onClick={() => setProgramIds(new Set())}>Clear</button>}
              </div>
              <div className="border border-slate-200 rounded p-2 max-h-40 overflow-y-auto space-y-1">
                {visiblePrograms.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={programIds.has(p.id)} onChange={() => toggleProgram(p.id)} />
                    {p.name}
                  </label>
                ))}
                {visiblePrograms.length === 0 && <p className="text-xs text-slate-400">No programs match the selected campus(es).</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {!loading && visibleCourses.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-psu font-semibold">Courses ({includedCourses.length} of {visibleCourses.length} included)</h2>
            <div className="flex gap-2 text-xs">
              <button className="btn-outline" onClick={() => setExcludedCourseIds(new Set())}>Select all</button>
              <button className="btn-outline" onClick={() => setExcludedCourseIds(new Set(visibleCourses.map((c) => c.id)))}>Clear all</button>
              <button className="btn-outline" disabled={includedCourses.length === 0} onClick={() => exportFile("xlsx")}>Export XLSX</button>
              <button className="btn-outline" disabled={includedCourses.length === 0} onClick={() => exportFile("csv")}>Export CSV</button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pl-2 w-6"></th>
                  <th className="py-1 px-2">Campus(es)</th>
                  <th className="py-1 px-2">Program</th>
                  <th className="py-1 px-2">Course Code</th>
                  <th className="py-1 px-2">Course Title</th>
                  <th className="py-1 px-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {visibleCourses.map((c) => {
                  const { program, campuses: campusList } = courseRowLabel(c);
                  const included = !excludedCourseIds.has(c.id);
                  return (
                    <tr key={c.id} className={"border-b border-slate-100 " + (included ? "" : "opacity-40")}>
                      <td className="py-1 pl-2"><input type="checkbox" checked={included} onChange={() => toggleCourse(c.id)} /></td>
                      <td className="py-1 px-2 text-slate-500">{campusList}</td>
                      <td className="py-1 px-2 text-slate-500">{program}</td>
                      <td className="py-1 px-2">{c.course_code}</td>
                      <td className="py-1 px-2 font-medium">{c.course_title}</td>
                      <td className="py-1 px-2 text-slate-600 max-w-[320px] truncate" title={c.description}>{c.description || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
