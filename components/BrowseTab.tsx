"use client";
import { useCallback, useEffect, useState } from "react";
import type { RecommendationRow } from "@/lib/types";

type Facets = {
  campus: string[]; college: string[]; program: string[];
  author: string[]; publisher: string[]; year: string[];
};

type Filters = {
  campus: string; college: string; program: string; course: string;
  author: string; publisher: string; year: string; style: string;
};

const EMPTY: Filters = {
  campus: "", college: "", program: "", course: "",
  author: "", publisher: "", year: "", style: "apa7",
};

export default function BrowseTab() {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<RecommendationRow[]>([]);
  const [biblio, setBiblio] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = await fetch("/api/facets").then((r) => r.json());
      setFacets(f);
    } catch { /* ignore */ }
    try {
      const p = toParams(filters);
      const data = await fetch("/api/recommendations?" + p).then((r) => r.json());
      setRows(data.rows ?? []);
      setBiblio(data.bibliography ?? {});
    } catch { /* ignore */ }
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  function toParams(f: Filters): string {
    const p = new URLSearchParams();
    (Object.keys(f) as (keyof Filters)[]).forEach((k) => { if (f[k]) p.set(k, f[k]); });
    return p.toString();
  }

  function download(fmt: string) {
    const p = new URLSearchParams(toParams(filters));
    p.set("fmt", fmt);
    window.location.href = "/api/export?" + p.toString();
  }

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <>
      <div className="card">
        <h2 className="text-psu font-semibold mb-3">Filters</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <Select value={filters.campus} onChange={set("campus")} options={facets?.campus} placeholder="All campuses" />
          <Select value={filters.college} onChange={set("college")} options={facets?.college} placeholder="All colleges" />
          <Select value={filters.program} onChange={set("program")} options={facets?.program} placeholder="All programs" />
          <input className="input" value={filters.course} onChange={set("course")} placeholder="Course contains..." />
          <Select value={filters.author} onChange={set("author")} options={facets?.author} placeholder="All authors" />
          <Select value={filters.publisher} onChange={set("publisher")} options={facets?.publisher} placeholder="All publishers" />
          <Select value={filters.year} onChange={set("year")} options={facets?.year} placeholder="All years" />
          <select className="input" value={filters.style} onChange={set("style")}>
            <option value="apa7">APA 7</option>
            <option value="mla9">MLA 9</option>
            <option value="chicago">Chicago</option>
            <option value="harvard">Harvard</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={load} disabled={loading}>{loading ? "Loading..." : "Apply"}</button>
          <span className="text-sm text-slate-600 mr-2">Export:</span>
          {["xlsx", "csv", "pdf", "docx"].map((fmt) => (
            <button key={fmt} className="btn-outline uppercase text-xs" onClick={() => download(fmt)}>
              {fmt}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Master Recommendation Table</h2>
        <p className="text-xs text-slate-500 mb-2">{rows.length} rows.</p>
        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-xs">
            <thead className="bg-psu-light sticky top-0">
              <tr>
                {["Campus", "College", "Program", "Course", "Book Title", "Author", "Year", "Publisher", "Copies"].map((h) => (
                  <th key={h} className="text-left p-2 border-b border-slate-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 1000).map((r, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="p-2">{r.Campus}</td>
                  <td className="p-2">{r.College}</td>
                  <td className="p-2">{r.Program}</td>
                  <td className="p-2">{r.Course}</td>
                  <td className="p-2">{r["Book Title"]}</td>
                  <td className="p-2">{r.Author}</td>
                  <td className="p-2">{r["Publication Year"]}</td>
                  <td className="p-2">{r.Publisher}</td>
                  <td className="p-2">{r["Number of Copies"]}</td>
                </tr>
              ))}
              {rows.length > 1000 && (
                <tr><td colSpan={9} className="p-2 text-slate-500">
                  Showing first 1000 of {rows.length}. Use Export for the full list.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Bibliographies</h2>
        {Object.keys(biblio).length === 0 ? (
          <p className="text-sm text-slate-500">No bibliography entries.</p>
        ) : (
          Object.keys(biblio).sort().map((k) => (
            <div key={k} className="mb-4">
              <h3 className="text-sm text-psu font-semibold mb-1">{k}</h3>
              <ol className="list-decimal pl-5 text-xs space-y-0.5">
                {biblio[k].map((c, i) => <li key={i}>{c}</li>)}
              </ol>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function Select({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[] | undefined;
  placeholder: string;
}) {
  return (
    <select className="input" value={value} onChange={onChange}>
      <option value="">{placeholder}</option>
      {(options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
