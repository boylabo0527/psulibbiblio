"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { HeatmapCell } from "@/app/api/procurement/heatmap/route";

/** Red (0%) -> yellow (50%) -> green (100%), for the compliance-rate cell background. */
function rateColor(rate: number): string {
  const clamped = Math.max(0, Math.min(100, rate));
  const stops: [number, [number, number, number]][] = [
    [0, [252, 165, 165]],   // red-300
    [50, [253, 224, 71]],   // yellow-300
    [100, [134, 239, 172]], // green-300
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i][0] && clamped <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = hi[0] - lo[0] || 1;
  const t = (clamped - lo[0]) / span;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const [r, g, b] = [mix(lo[1][0], hi[1][0]), mix(lo[1][1], hi[1][1]), mix(lo[1][2], hi[1][2])];
  return `rgb(${r}, ${g}, ${b})`;
}

export default function ProcurementHeatmap() {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch("/api/procurement/heatmap")
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setCells(j.cells ?? []); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const { programs, campuses, grid } = useMemo(() => {
    const byProgram = new Map<number, { name: string; campusSet: Set<string> }>();
    for (const c of cells) {
      if (!byProgram.has(c.program_id)) byProgram.set(c.program_id, { name: c.program, campusSet: new Set() });
      byProgram.get(c.program_id)!.campusSet.add(c.campus);
    }
    const programEntries = Array.from(byProgram.entries())
      .filter(([, v]) => showAll || v.campusSet.size > 1)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    const programIds = new Set(programEntries.map(([id]) => id));

    const campusSet = new Set<string>();
    for (const c of cells) if (programIds.has(c.program_id)) campusSet.add(c.campus);
    const campusList = Array.from(campusSet).sort();

    const grid = new Map<string, HeatmapCell>();
    for (const c of cells) if (programIds.has(c.program_id)) grid.set(`${c.program_id}|${c.campus}`, c);

    return {
      programs: programEntries.map(([id, v]) => ({ id, name: v.name })),
      campuses: campusList,
      grid,
    };
  }, [cells, showAll]);

  if (loading) return <p className="text-slate-500 text-sm">Loading heatmap…</p>;
  if (err) return <p className="text-red-700 text-sm">{err}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">
          Share of subjects meeting full compliance ({">"}= 5 recent titles), per program per campus.
          Blank cells mean that program isn&apos;t offered at that campus.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show single-campus programs too
        </label>
      </div>

      {programs.length === 0 ? (
        <p className="text-slate-500 text-sm">
          {showAll ? "No programs found." : "No programs are offered at more than one campus yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white text-left p-1.5 pr-3 border-b border-slate-200 min-w-[220px]">Program</th>
                {campuses.map((c) => (
                  <th key={c} className="p-1.5 text-center border-b border-slate-200 whitespace-nowrap font-medium text-slate-600" style={{ minWidth: 70 }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {programs.map((p) => (
                <tr key={p.id}>
                  <td className="sticky left-0 bg-white p-1.5 pr-3 border-b border-slate-100 whitespace-nowrap">{p.name}</td>
                  {campuses.map((c) => {
                    const cell = grid.get(`${p.id}|${c}`);
                    return (
                      <td key={c} className="p-1 border-b border-slate-100 text-center">
                        {cell ? (
                          <div
                            className="rounded px-1 py-1 font-semibold"
                            style={{ backgroundColor: rateColor(cell.complianceRate) }}
                            title={`${cell.program} @ ${cell.campus}: ${cell.compliant} compliant, ${cell.partial} partial, ${cell.needs} need procurement (of ${cell.totalSubjects} subjects)`}
                          >
                            {cell.complianceRate}%
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        <span>Compliance rate:</span>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: rateColor(0) }} /> 0%
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: rateColor(50) }} /> 50%
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: rateColor(100) }} /> 100%
        </div>
      </div>
    </div>
  );
}
