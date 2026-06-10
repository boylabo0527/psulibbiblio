"use client";
import { useState } from "react";

type Props = {
  title: string;
  hint: string;
  endpoint: string;
  extraFields?: { name: string; label: string; placeholder?: string }[];
};

function FileCard({ title, hint, endpoint, extraFields }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function send() {
    if (!file) return;
    setBusy(true);
    setResult("Uploading...");
    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(extras)) if (v) fd.append(k, v);
      const res = await fetch(endpoint, { method: "POST", body: fd });
      setResult(JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">{title}</h2>
      <p className="text-sm text-slate-600 mb-3">{hint}</p>
      {extraFields?.map((f) => (
        <div key={f.name} className="mb-2">
          <label className="label">{f.label}</label>
          <input
            className="input w-72"
            placeholder={f.placeholder}
            value={extras[f.name] ?? ""}
            onChange={(e) => setExtras((p) => ({ ...p, [f.name]: e.target.value }))}
          />
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <input type="file" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn" onClick={send} disabled={!file || busy}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </div>
      {result && <pre className="mt-3 bg-slate-100 rounded p-2 text-xs overflow-auto max-h-48">{result}</pre>}
    </div>
  );
}

export default function UploadTab() {
  const [resetResult, setResetResult] = useState("");
  async function reset() {
    if (!confirm("Wipe all programs, subjects, titles, and assignments?")) return;
    setResetResult("Resetting...");
    const r = await fetch("/api/admin/reset", { method: "POST" });
    setResetResult(JSON.stringify(await r.json(), null, 2));
  }

  return (
    <>
      <FileCard
        title="1. Upload Subjects (per program)"
        hint="Spreadsheet with one row per subject. Recognized columns: program, campus, college, section (e.g. MAJOR COURSES), course code, course title, description. If 'program' is missing from the file, set the program override below."
        endpoint="/api/upload/subjects"
        extraFields={[
          { name: "program", label: "Program override", placeholder: "e.g. BA Political Science" },
          { name: "campus", label: "Campus override", placeholder: "Main Campus" },
          { name: "college", label: "College override", placeholder: "College of Arts and Humanities" },
        ]}
      />
      <FileCard
        title="2. Upload Perlego title list (eBooks)"
        hint="Marked as eBooks (Kavita). Accepts .xlsx, .xls, .csv, .pdf, .docx. Auto-detects publication_title, first_author, publisher_name, year, online_identifier."
        endpoint="/api/upload/titles"
      />
      <FileCard
        title="3. Upload Printed Books catalog"
        hint="Library catalog rows. Recognized columns: Call No., Author, Title, Year, Copies, Publisher."
        endpoint="/api/upload/printed"
      />
      <div className="card border-red-300">
        <h2 className="text-red-700 font-semibold mb-2">Admin</h2>
        <button className="btn bg-red-600 hover:bg-red-700" onClick={reset}>Wipe all data</button>
        {resetResult && <pre className="mt-3 bg-slate-100 rounded p-2 text-xs">{resetResult}</pre>}
      </div>
    </>
  );
}
