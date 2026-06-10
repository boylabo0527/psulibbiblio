"use client";
import { useRef, useState } from "react";

type ProgressEvent =
  | { phase: "parsing" }
  | { phase: "parsed"; total: number }
  | { phase: "inserting"; inserted: number; total: number }
  | { phase: "done"; received: number; inserted: number; programs?: number }
  | { phase: "error"; error: string };

type Status = {
  phase: ProgressEvent["phase"] | "idle" | "uploading";
  inserted: number;
  total: number;
  programs?: number;
  error?: string;
  stalled?: boolean;
  elapsedMs: number;
};

const IDLE: Status = { phase: "idle", inserted: 0, total: 0, elapsedMs: 0 };
const STALL_MS = 10_000;

type Props = {
  title: string;
  hint: string;
  endpoint: string;
  templates?: { label: string; href: string }[];
  extraFields?: { name: string; label: string; placeholder?: string }[];
};

function FileCard({ title, hint, endpoint, templates, extraFields }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>(IDLE);
  const startedAt = useRef(0);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventAt = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  function update(partial: Partial<Status>) {
    setStatus((prev) => ({ ...prev, ...partial }));
  }

  function startTicking() {
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = setInterval(() => {
      setStatus((prev) => {
        const now = Date.now();
        return {
          ...prev,
          elapsedMs: now - startedAt.current,
          stalled: now - lastEventAt.current > STALL_MS && prev.phase !== "done" && prev.phase !== "error",
        };
      });
    }, 500);
  }

  function stopTicking() {
    if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null; }
  }

  async function send() {
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    startedAt.current = Date.now();
    lastEventAt.current = Date.now();
    setStatus({ phase: "uploading", inserted: 0, total: 0, elapsedMs: 0 });
    startTicking();

    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(extras)) if (v) fd.append(k, v);

      const res = await fetch(endpoint, { method: "POST", body: fd, signal: controller.signal });
      if (!res.ok || !res.body) {
        const text = await res.text();
        update({ phase: "error", error: text || `HTTP ${res.status}` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: ProgressEvent;
          try { ev = JSON.parse(line) as ProgressEvent; } catch { continue; }
          lastEventAt.current = Date.now();
          if (ev.phase === "parsed") update({ phase: ev.phase, total: ev.total, stalled: false });
          else if (ev.phase === "inserting") update({ phase: ev.phase, inserted: ev.inserted, total: ev.total, stalled: false });
          else if (ev.phase === "done") update({ phase: "done", inserted: ev.inserted, total: ev.received, programs: ev.programs, stalled: false });
          else if (ev.phase === "error") update({ phase: "error", error: ev.error, stalled: false });
          else update({ phase: ev.phase, stalled: false });
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        update({ phase: "error", error: (e as Error).message });
      }
    } finally {
      stopTicking();
      setStatus((s) => ({ ...s, elapsedMs: Date.now() - startedAt.current }));
    }
  }

  function cancel() {
    abortRef.current?.abort();
    stopTicking();
    update({ phase: "error", error: "Cancelled" });
  }

  const busy = status.phase !== "idle" && status.phase !== "done" && status.phase !== "error";
  const pct = status.total > 0 ? Math.round((status.inserted / status.total) * 100) : 0;
  const phaseLabel = ({
    idle: "",
    uploading: "Uploading file...",
    parsing: "Parsing file...",
    parsed: `Parsed ${status.total.toLocaleString()} rows. Inserting...`,
    inserting: `Inserting ${status.inserted.toLocaleString()} / ${status.total.toLocaleString()}`,
    done: `Done. Inserted ${status.inserted.toLocaleString()} of ${status.total.toLocaleString()}${status.programs ? ` · ${status.programs} program(s) created` : ""}.`,
    error: `Error: ${status.error}`,
  } as Record<Status["phase"], string>)[status.phase];

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">{title}</h2>
      <p className="text-sm text-slate-600 mb-2">{hint}</p>
      {templates && templates.length > 0 && (
        <p className="text-xs text-slate-600 mb-3">
          <span className="font-medium">Template:</span>{" "}
          {templates.map((t, i) => (
            <span key={t.href}>
              {i > 0 && <span className="text-slate-400 mx-1">·</span>}
              <a href={t.href} download className="text-psu underline">{t.label}</a>
            </span>
          ))}
        </p>
      )}
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
        {!busy && <button className="btn" onClick={send} disabled={!file}>Upload</button>}
        {busy && <button className="btn bg-red-600 hover:bg-red-700" onClick={cancel}>Cancel</button>}
      </div>

      {status.phase !== "idle" && (
        <div className="mt-3">
          <div className="h-2 w-full bg-slate-200 rounded overflow-hidden">
            <div
              className={
                "h-full transition-all " +
                (status.phase === "error" ? "bg-red-500" :
                 status.phase === "done"  ? "bg-emerald-500" :
                 status.stalled            ? "bg-amber-500" :
                                             "bg-psu")
              }
              style={{ width: status.phase === "uploading" || status.phase === "parsing"
                ? "10%"
                : status.phase === "parsed" ? "15%"
                : status.phase === "done" || status.phase === "error" ? "100%"
                : `${Math.max(15, pct)}%` }}
            />
          </div>
          <div className="mt-1 text-xs flex justify-between gap-2 flex-wrap">
            <span className={
              status.phase === "error" ? "text-red-700" :
              status.phase === "done"  ? "text-emerald-700" :
              status.stalled ? "text-amber-700" : "text-slate-700"
            }>
              {phaseLabel}
              {status.stalled && status.phase !== "error" && " · no progress for >10s, server may be stalled"}
            </span>
            <span className="text-slate-500 tabular-nums">
              {(status.elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      )}
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
        templates={[
          { label: "subjects_template.xlsx", href: "/templates/subjects_template.xlsx" },
          { label: "subjects_template.csv", href: "/templates/subjects_template.csv" },
        ]}
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
        templates={[
          { label: "perlego_ebooks_template.xlsx", href: "/templates/perlego_ebooks_template.xlsx" },
          { label: "perlego_ebooks_template.csv", href: "/templates/perlego_ebooks_template.csv" },
        ]}
      />
      <FileCard
        title="3. Upload Printed Books catalog"
        hint="Library catalog rows. Recognized columns: Call No., Author, Title, Year, Copies, Publisher."
        endpoint="/api/upload/printed"
        templates={[
          { label: "printed_books_template.xlsx", href: "/templates/printed_books_template.xlsx" },
          { label: "printed_books_template.csv", href: "/templates/printed_books_template.csv" },
        ]}
      />
      <div className="card border-red-300">
        <h2 className="text-red-700 font-semibold mb-2">Admin</h2>
        <button className="btn bg-red-600 hover:bg-red-700" onClick={reset}>Wipe all data</button>
        {resetResult && <pre className="mt-3 bg-slate-100 rounded p-2 text-xs">{resetResult}</pre>}
      </div>
    </>
  );
}
