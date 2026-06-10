"use client";
import { useEffect, useState } from "react";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";

type Dashboard = {
  totals: {
    programs: number; subjects: number; titles: number;
    assignments: number;
    byType: Record<ResourceTypeId, number>;
  };
};

export default function DashboardTab() {
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => {
    fetch("/api/dashboard").then((r) => r.json()).then(setD).catch(() => {});
  }, []);
  if (!d) return <p className="text-slate-500">Loading...</p>;

  const top = [
    { label: "Programs", value: d.totals.programs },
    { label: "Subjects", value: d.totals.subjects },
    { label: "Total Titles", value: d.totals.titles },
    { label: "Assignments", value: d.totals.assignments },
  ];

  return (
    <>
      <div className="card">
        <h2 className="text-psu font-semibold mb-3">Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {top.map((s) => (
            <div key={s.label} className="bg-psu-light rounded p-4">
              <div className="text-xs text-slate-600">{s.label}</div>
              <div className="text-2xl font-semibold text-psu">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2 className="text-psu font-semibold mb-3">By Resource Type</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {RESOURCE_TYPES.map((t) => (
            <div key={t.id} className="bg-slate-50 border border-slate-200 rounded p-4">
              <div className="text-xs text-slate-600">{t.uiLabel}</div>
              <div className="text-2xl font-semibold text-psu">{d.totals.byType?.[t.id] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
