"use client";
import { useEffect, useState } from "react";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";

type Dashboard = {
  totals?: {
    programs?: number; subjects?: number; titles?: number;
    assignments?: number;
    byType?: Record<ResourceTypeId, number>;
  };
  error?: string;
};

export default function DashboardTab() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) { setErr(j.error || `HTTP ${r.status}`); setD({}); return; }
        setD(j);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) {
    return (
      <div className="card border-red-300">
        <h2 className="text-red-700 font-semibold mb-1">Dashboard error</h2>
        <pre className="text-xs text-red-700 whitespace-pre-wrap">{err}</pre>
      </div>
    );
  }
  if (!d) return <p className="text-slate-500">Loading...</p>;

  const t = d.totals ?? {};
  const top = [
    { label: "Programs", value: t.programs ?? 0 },
    { label: "Subjects", value: t.subjects ?? 0 },
    { label: "Total Titles", value: t.titles ?? 0 },
    { label: "Assignments", value: t.assignments ?? 0 },
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
          {RESOURCE_TYPES.map((rt) => (
            <div key={rt.id} className="bg-slate-50 border border-slate-200 rounded p-4">
              <div className="text-xs text-slate-600">{rt.uiLabel}</div>
              <div className="text-2xl font-semibold text-psu">{t.byType?.[rt.id] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
