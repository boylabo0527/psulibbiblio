"use client";
import { useEffect, useState } from "react";

type Dashboard = {
  totals: { courses: number; titles: number; matches: number; matched_titles: number };
  top_publishers: { publisher: string; count: number }[];
  cross_program_titles: { title: string; programs: number }[];
};

export default function DashboardTab() {
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => { fetch("/api/dashboard").then((r) => r.json()).then(setD).catch(() => {}); }, []);
  if (!d) return <p className="text-slate-500">Loading...</p>;

  const stats = [
    { label: "Total Courses Processed", value: d.totals.courses },
    { label: "Total Titles Loaded", value: d.totals.titles },
    { label: "Total Matches", value: d.totals.matches },
    { label: "Distinct Titles Matched", value: d.totals.matched_titles },
  ];

  return (
    <>
      <div className="card">
        <h2 className="text-psu font-semibold mb-3">Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-psu-light rounded p-4">
              <div className="text-xs text-slate-600">{s.label}</div>
              <div className="text-2xl font-semibold text-psu">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Top Publishers</h2>
        <ol className="list-decimal pl-5 text-sm">
          {d.top_publishers.map((p) => (
            <li key={p.publisher}>{p.publisher} <span className="text-slate-500">({p.count})</span></li>
          ))}
        </ol>
      </div>
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Titles Recommended Across Multiple Programs</h2>
        <ol className="list-decimal pl-5 text-sm">
          {d.cross_program_titles.map((t) => (
            <li key={t.title}>{t.title} <span className="text-slate-500">({t.programs} programs)</span></li>
          ))}
        </ol>
      </div>
    </>
  );
}
