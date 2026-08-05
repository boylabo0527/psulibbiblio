"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { isSpreadsheet, parseSheetRows } from "@/lib/parse-client";
import { groupRows } from "@/lib/group-rows";
import type { ComparisonSubject } from "@/app/api/standard-titles/compare/route";

type ParsedRow = {
  program: string; course_code: string; title: string;
  author: string; publisher: string; year: string; isbn: string; notes: string;
};

function mapRow(raw: Record<string, string>): ParsedRow {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.entries(raw).find(([rk]) => rk.toLowerCase() === k.toLowerCase());
      if (found && found[1] !== "") return found[1];
    }
    return "";
  };
  return {
    program: get("program"),
    course_code: get("course code", "course_code", "code"),
    title: get("title", "book title"),
    author: get("author", "authors"),
    publisher: get("publisher"),
    year: get("year"),
    isbn: get("isbn"),
    notes: get("notes", "remarks"),
  };
}

async function downloadTemplate(fmt: "xlsx" | "csv") {
  const XLSX = await import("xlsx");
  const headers = ["Program", "Course Code", "Title", "Author", "Publisher", "Year", "ISBN", "Notes"];
  const example = ["BA Political Science", "PSM 1", "Introduction to Philosophy", "Popkin, Richard", "Cengage", "2020", "978-0-123456-78-9", ""];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Standard Titles");
  const buf = XLSX.write(wb, { type: "buffer", bookType: fmt });
  const blob = new Blob([buf], { type: fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `standard_titles_template.${fmt}`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

/** Compares the actual catalog against the library committee's authoritative
 *  "standard titles" list per course (set/uploaded in bulk by an admin) --
 *  the definitive reading list a committee decided a course should have,
 *  as opposed to Procurement Analysis's bare count-based gap. */
export default function StandardTitlesTab() {
  const { perms } = usePermissions();
  const canEdit = perms.isAdmin || !!perms.tabs["standard-titles"]?.can_edit;

  const [subjects, setSubjects] = useState<ComparisonSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [programFilter, setProgramFilter] = useState("");
  const [showOnlyIncomplete, setShowOnlyIncomplete] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Upload
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; errors: { row: number; reason: string }[] } | null>(null);

  function load() {
    setLoading(true);
    setErr(null);
    apiFetch("/api/standard-titles/compare")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setSubjects(j.subjects ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const programOptions = useMemo(() => Array.from(new Set(subjects.map((s) => s.program).filter(Boolean))).sort(), [subjects]);

  const displayed = subjects
    .filter((s) => !programFilter || s.program === programFilter)
    .filter((s) => !showOnlyIncomplete || s.matched_count < s.total_count);

  const groups = useMemo(() => groupRows(displayed, "program", (s) => s.program), [displayed]);

  const overallTotal = subjects.reduce((a, s) => a + s.total_count, 0);
  const overallMatched = subjects.reduce((a, s) => a + s.matched_count, 0);

  async function handleFile(file: File) {
    if (!isSpreadsheet(file)) { setUploadErr("Please upload an Excel (.xlsx/.xls) or CSV file."); return; }
    setParsing(true); setUploadErr(null); setUploadResult(null); setParsed([]);
    try {
      const rawRows = await parseSheetRows(file);
      const mapped = rawRows.map(mapRow).filter((r) => r.title.trim() !== "");
      if (mapped.length === 0) { setUploadErr("No valid rows found. Ensure the file has Program, Course Code, and Title columns."); return; }
      setParsed(mapped);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally { setParsing(false); }
  }

  async function importParsed() {
    if (parsed.length === 0) return;
    setUploading(true); setUploadErr(null); setUploadResult(null);
    try {
      const res = await apiFetch("/api/standard-titles/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { setUploadErr(j.error || `HTTP ${res.status}`); return; }
      setUploadResult({ inserted: j.inserted ?? 0, errors: j.errors ?? [] });
      setParsed([]);
      load();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally { setUploading(false); }
  }

  async function removeEntry(id: number) {
    if (!confirm("Remove this standard title?")) return;
    setBusyId(id);
    try {
      await apiFetch(`/api/standard-titles?id=${id}`, { method: "DELETE" });
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-1">Upload Standard Titles</h2>
          <p className="text-xs text-slate-500 mb-1">
            The library committee's authoritative reading list per course -- upload it in bulk here, then compare it
            against the actual catalog below. Program and Course Code must exactly match an existing program/course;
            a row that doesn't match is reported back instead of guessed at.
          </p>
          <div className="flex gap-2 mb-4 text-xs">
            <span className="text-slate-400">Download template:</span>
            <button className="text-psu underline" onClick={() => downloadTemplate("xlsx")}>XLSX</button>
            <button className="text-psu underline" onClick={() => downloadTemplate("csv")}>CSV</button>
          </div>
          <label className="label flex-col items-start gap-1 mb-3">
            <span>Standard titles file</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="text-xs"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </label>
          {parsing && <p className="text-slate-500 text-sm">Parsing file…</p>}
          {uploadErr && <p className="text-red-700 text-sm mb-2">{uploadErr}</p>}
          {uploadResult && (
            <div className="text-sm mb-2">
              <p className="text-emerald-700">{uploadResult.inserted} title(s) added.</p>
              {uploadResult.errors.length > 0 && (
                <div className="text-amber-700 text-xs mt-1">
                  {uploadResult.errors.length} row(s) skipped:
                  <ul className="list-disc list-inside">
                    {uploadResult.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
                    {uploadResult.errors.length > 10 && <li>…and {uploadResult.errors.length - 10} more.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          {parsed.length > 0 && (
            <>
              <div className="overflow-x-auto mb-3 max-h-64 overflow-y-auto border border-slate-200 rounded">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1 px-2">Program</th>
                      <th className="py-1 px-2">Course</th>
                      <th className="py-1 px-2">Title</th>
                      <th className="py-1 px-2">Author</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 px-2">{r.program}</td>
                        <td className="py-1 px-2">{r.course_code}</td>
                        <td className="py-1 px-2">{r.title}</td>
                        <td className="py-1 px-2">{r.author}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn text-sm" disabled={uploading} onClick={importParsed}>
                {uploading ? "Uploading…" : `Upload ${parsed.length} row(s)`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-psu font-semibold">Standard Titles Comparison</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-slate-500 flex items-center gap-1.5">
              Program:
              <select className="input text-xs py-1" value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
                <option value="">All programs</option>
                {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600 flex items-center gap-1.5">
              <input type="checkbox" checked={showOnlyIncomplete} onChange={(e) => setShowOnlyIncomplete(e.target.checked)} />
              Only incomplete courses
            </label>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          {overallTotal > 0
            ? <>{overallMatched} of {overallTotal} standard titles are already in the catalog ({subjects.length} course{subjects.length === 1 ? "" : "s"} with a standard list set).</>
            : "No standard titles set yet -- upload the committee's list above to start comparing."}
        </p>
        {err && <p className="text-red-700 text-sm mb-2">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && groups.flatMap(([, subs]) => subs).length === 0 && subjects.length > 0 && (
          <p className="text-slate-500 text-sm">No courses match this filter.</p>
        )}
        {!loading && groups.map(([program, subs]) => (
          <div key={program} className="mb-5">
            <h3 className="text-sm font-semibold text-psu mb-2 pb-1 border-b border-slate-200">{program}</h3>
            {subs.map((s) => (
              <div key={s.subject_id} className="mb-3 ml-2">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-600 mb-1">
                  <span>{s.course_code} — {s.course_title}</span>
                  <span className={"px-1.5 py-0.5 rounded text-[10px] font-medium " + (s.matched_count === s.total_count ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                    {s.matched_count}/{s.total_count} in catalog
                  </span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {s.entries.map((e) => (
                      <tr key={e.standard_title_id} className="border-b border-slate-100">
                        <td className="py-1 pr-2 w-6">
                          {e.matched ? <span className="text-emerald-600" title="Found in catalog">✓</span> : <span className="text-red-500" title="Not found in catalog">✗</span>}
                        </td>
                        <td className="py-1 pr-2 font-medium">{e.title}{e.year ? ` (${e.year})` : ""}</td>
                        <td className="py-1 pr-2 text-slate-600">{e.author}</td>
                        <td className="py-1 pl-2 text-right">
                          {canEdit && (
                            <button className="text-red-500 text-[11px] underline disabled:opacity-40" disabled={busyId === e.standard_title_id} onClick={() => removeEntry(e.standard_title_id)}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
