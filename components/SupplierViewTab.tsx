"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { SupplierNeedRow } from "@/app/api/supplier/needs/route";

export default function SupplierViewTab() {
  const [rows, setRows] = useState<SupplierNeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/supplier/needs")
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setRows(j.rows ?? []); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">Titles We Need</h2>
      <p className="text-sm text-slate-600 mb-4">
        Subjects currently short of the required number of recent titles. Numbers show what's already in our
        collection (printed / digital) and how many more titles are still needed overall.
      </p>

      {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-slate-500 text-sm">No open needs right now.</p>}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-left">
                <th className="py-1 pr-2">Program</th>
                <th className="py-1 pr-2 w-24">Code</th>
                <th className="py-1 pr-2">Subject</th>
                <th className="py-1 px-2 text-right">Have (Printed)</th>
                <th className="py-1 px-2 text-right">Have (Digital)</th>
                <th className="py-1 pl-2 text-right">Titles Needed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{r.course_code}</td>
                  <td className="py-1.5 pr-2">{r.course_title}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.current_printed}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.current_digital}</td>
                  <td className="py-1.5 pl-2 text-right font-semibold tabular-nums text-red-600">+{r.gap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
