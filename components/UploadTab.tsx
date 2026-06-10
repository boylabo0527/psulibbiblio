"use client";
import { useState } from "react";

function FileCard({
  title, hint, endpoint,
}: { title: string; hint: string; endpoint: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  async function send() {
    if (!file) return;
    setBusy(true);
    setResult("Uploading...");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const json = await res.json();
      setResult(JSON.stringify(json, null, 2));
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
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="file"
          className="input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button className="btn" onClick={send} disabled={!file || busy}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </div>
      {result && (
        <pre className="mt-3 bg-slate-100 rounded p-2 text-xs overflow-auto max-h-48">{result}</pre>
      )}
    </div>
  );
}

export default function UploadTab() {
  const [resetResult, setResetResult] = useState("");
  const [seedResult, setSeedResult] = useState("");

  async function reset() {
    if (!confirm("Wipe all titles, courses, and matches?")) return;
    setResetResult("Resetting...");
    const r = await fetch("/api/admin/reset", { method: "POST" });
    setResetResult(JSON.stringify(await r.json(), null, 2));
  }
  async function seed() {
    setSeedResult("Seeding...");
    const r = await fetch("/api/admin/seed", { method: "POST" });
    setSeedResult(JSON.stringify(await r.json(), null, 2));
  }

  return (
    <>
      <FileCard
        title="Upload Perlego Title List"
        hint="Accepted: .xlsx, .xls, .csv, .pdf, .docx. Auto-detects publication_title / first_author / publisher_name / year / online_identifier."
        endpoint="/api/upload/titles"
      />
      <FileCard
        title="Upload Course Descriptions"
        hint="Optional. The PSU program catalog can be seeded automatically below."
        endpoint="/api/upload/courses"
      />
      <div className="card border-amber-300">
        <h2 className="text-psu font-semibold mb-2">Seed PSU programs</h2>
        <p className="text-sm text-slate-600 mb-3">
          Inserts the PSU campus / college / program / major rows from <code>data/psu_programs.csv</code> into <code>courses</code>.
        </p>
        <button className="btn" onClick={seed}>Seed programs</button>
        {seedResult && <pre className="mt-3 bg-slate-100 rounded p-2 text-xs">{seedResult}</pre>}
      </div>
      <div className="card border-red-300">
        <h2 className="text-red-700 font-semibold mb-2">Admin</h2>
        <button className="btn bg-red-600 hover:bg-red-700" onClick={reset}>
          Wipe all data
        </button>
        {resetResult && <pre className="mt-3 bg-slate-100 rounded p-2 text-xs">{resetResult}</pre>}
      </div>
    </>
  );
}
