"use client";
import { useRef, useState } from "react";
import { parseSheetRows, isSpreadsheet } from "@/lib/parse-client";
import { apiFetch } from "@/lib/api-client";
import { PSU_CAMPUSES } from "@/lib/campuses";

type ProgressEvent =
  | { phase: "parsing" }
  | { phase: "parsed"; total: number }
  | { phase: "deduping"; existing: number }
  | { phase: "inserting"; inserted: number; skipped: number; total: number }
  | { phase: "done"; received: number; inserted: number; skipped: number; programs?: number }
  | { phase: "error"; error: string };

type FilePhase = ProgressEvent["phase"] | "idle" | "uploading" | "queued";

type FileStatus = {
  file: File;
  phase: FilePhase;
  inserted: number;
  skipped: number;
  total: number;
  programs?: number;
  error?: string;
  elapsedMs: number;
};

const STALL_MS = 10_000;


type Props = {
  title: string;
  hint: string;
  endpoint: string;
  templates?: { label: string; href: string }[];
  extraFields?: { name: string; label: string; type?: "text" | "campus"; placeholder?: string }[];
};

async function consumeNdjson(
  res: Response,
  onEvent: (ev: ProgressEvent) => void,
  signal: AbortSignal,
) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal.aborted) { reader.cancel(); break; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line) as ProgressEvent); } catch { /* skip */ }
    }
  }
}

function FileCard({ title, hint, endpoint, templates, extraFields }: Props) {
  const [queue, setQueue] = useState<FileStatus[]>([]);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  function patchFile(index: number, patch: Partial<FileStatus>) {
    setQueue((prev) => prev.map((f, i) => i === index ? { ...f, ...patch } : f));
  }

  async function uploadOne(fs: FileStatus, index: number, controller: AbortController) {
    const { file } = fs;
    const startedAt = Date.now();
    patchFile(index, { phase: "uploading", elapsedMs: 0 });

    // Tick elapsed time while uploading.
    const ticker = setInterval(() => {
      patchFile(index, { elapsedMs: Date.now() - startedAt });
    }, 500);

    try {
      if (isSpreadsheet(file)) {
        patchFile(index, { phase: "parsing" });
        const allRows = await parseSheetRows(file);
        const BATCH = 1_000;
        const total = allRows.length;
        let inserted = 0;
        let skipped = 0;
        patchFile(index, { phase: "parsed", total });

        for (let i = 0; i < allRows.length; i += BATCH) {
          if (controller.signal.aborted) break;
          const rows = allRows.slice(i, i + BATCH);
          const res = await apiFetch(endpoint, {
            method: "POST",
            body: JSON.stringify({ rows, filename: file.name, ...extras }),
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
          });
          if (!res.ok) {
            const text = await res.text();
            patchFile(index, { phase: "error", error: text || `HTTP ${res.status}` });
            return;
          }
          await consumeNdjson(res, (ev) => {
            if (ev.phase === "done") {
              inserted += ev.inserted;
              skipped += ev.skipped;
              patchFile(index, { phase: "inserting", inserted, skipped, total });
            } else if (ev.phase === "error") {
              patchFile(index, { phase: "error", error: ev.error });
            }
          }, controller.signal);
        }
        patchFile(index, { phase: "done", inserted, skipped, total, elapsedMs: Date.now() - startedAt });
      } else {
        const fd = new FormData();
        fd.append("file", file);
        for (const [k, v] of Object.entries(extras)) if (v) fd.append(k, v);
        const res = await apiFetch(endpoint, { method: "POST", body: fd, signal: controller.signal });
        if (!res.ok) {
          const text = await res.text();
          patchFile(index, { phase: "error", error: text || `HTTP ${res.status}` });
          return;
        }
        await consumeNdjson(res, (ev) => {
          if (ev.phase === "parsed") patchFile(index, { phase: ev.phase, total: ev.total });
          else if (ev.phase === "deduping") patchFile(index, { phase: ev.phase });
          else if (ev.phase === "inserting") patchFile(index, { phase: ev.phase, inserted: ev.inserted, skipped: ev.skipped, total: ev.total });
          else if (ev.phase === "done") patchFile(index, { phase: "done", inserted: ev.inserted, skipped: ev.skipped, total: ev.received, programs: ev.programs, elapsedMs: Date.now() - startedAt });
          else if (ev.phase === "error") patchFile(index, { phase: "error", error: ev.error });
        }, controller.signal);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        patchFile(index, { phase: "error", error: (e as Error).message });
      }
    } finally {
      clearInterval(ticker);
      patchFile(index, { elapsedMs: Date.now() - startedAt });
    }
  }

  async function runQueue(items: FileStatus[]) {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    for (let i = 0; i < items.length; i++) {
      if (controller.signal.aborted) break;
      const current = items[i];
      if (current.phase !== "queued") continue;
      await uploadOne(current, i, controller);
    }
    runningRef.current = false;
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newItems: FileStatus[] = files.map((f) => ({
      file: f, phase: "queued", inserted: 0, skipped: 0, total: 0, elapsedMs: 0,
    }));
    setQueue(newItems);
    // Start after state update.
    setTimeout(() => runQueue(newItems), 0);
    e.target.value = "";
  }

  function cancel() {
    abortRef.current?.abort();
    runningRef.current = false;
    setQueue((prev) =>
      prev.map((f) =>
        f.phase === "queued" || f.phase === "uploading" || f.phase === "parsing" || f.phase === "parsed" || f.phase === "deduping" || f.phase === "inserting"
          ? { ...f, phase: "error", error: "Cancelled" }
          : f,
      ),
    );
  }

  const busy = queue.some((f) =>
    f.phase !== "idle" && f.phase !== "queued" && f.phase !== "done" && f.phase !== "error"
      ? true
      : f.phase === "queued",
  );

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
          {f.type === "campus" ? (
            <select
              className="input w-72"
              value={extras[f.name] ?? ""}
              onChange={(e) => setExtras((p) => ({ ...p, [f.name]: e.target.value }))}
            >
              <option value="">— select campus —</option>
              {PSU_CAMPUSES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            <input
              className="input w-72"
              value={extras[f.name] ?? ""}
              onChange={(e) => setExtras((p) => ({ ...p, [f.name]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="btn cursor-pointer">
          {busy ? "Add more…" : "Choose files"}
          <input type="file" multiple className="sr-only" onChange={onFilesSelected} />
        </label>
        {busy && (
          <button className="btn bg-red-600 hover:bg-red-700" onClick={cancel}>Cancel all</button>
        )}
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 space-y-2">
          {queue.map((fs, i) => {
            const skippedSuffix = fs.skipped > 0
              ? `, skipped ${fs.skipped.toLocaleString()} dup${fs.skipped === 1 ? "" : "s"}`
              : "";
            const label = ({
              idle: "Waiting…",
              queued: "Queued",
              uploading: "Uploading…",
              parsing: "Parsing…",
              parsed: `Parsed ${fs.total.toLocaleString()} rows`,
              deduping: "Deduplicating…",
              inserting: `${fs.inserted.toLocaleString()} / ${fs.total.toLocaleString()}${skippedSuffix}`,
              done: `Done — ${fs.inserted.toLocaleString()} inserted${skippedSuffix}`,
              error: `Error: ${fs.error}`,
            } as Record<FilePhase, string>)[fs.phase];

            const pct = fs.total > 0 ? Math.round((fs.inserted / fs.total) * 100) : 0;
            const barColor =
              fs.phase === "error" ? "bg-red-500" :
              fs.phase === "done"  ? "bg-emerald-500" :
              fs.phase === "queued" ? "bg-slate-300" : "bg-psu";
            const barWidth =
              fs.phase === "done" || fs.phase === "error" ? "100%" :
              fs.phase === "queued" ? "0%" :
              fs.phase === "uploading" || fs.phase === "parsing" || fs.phase === "parsed" || fs.phase === "deduping" ? "10%" :
              `${Math.max(10, pct)}%`;

            return (
              <li key={i} className="text-xs">
                <div className="flex justify-between mb-0.5">
                  <span className="truncate max-w-[60%] text-slate-700 font-medium">{fs.file.name}</span>
                  <span className={
                    fs.phase === "error" ? "text-red-700" :
                    fs.phase === "done"  ? "text-emerald-700" :
                    fs.phase === "queued" ? "text-slate-400" : "text-slate-600"
                  }>{label}</span>
                </div>
                <div className="h-1.5 w-full bg-slate-200 rounded overflow-hidden">
                  <div className={`h-full transition-all ${barColor}`} style={{ width: barWidth }} />
                </div>
                {fs.phase !== "queued" && fs.phase !== "idle" && (
                  <div className="text-right text-slate-400 mt-0.5">{(fs.elapsedMs / 1000).toFixed(1)}s</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function UploadTab() {
  const [resetResult, setResetResult] = useState("");
  async function reset() {
    if (!confirm("Wipe all programs, subjects, titles, and assignments?")) return;
    setResetResult("Resetting...");
    const r = await apiFetch("/api/admin/reset", { method: "POST" });
    setResetResult(JSON.stringify(await r.json(), null, 2));
  }

  return (
    <>
      <FileCard
        title="1. Upload Subjects (per program)"
        hint="Curriculum subjects. Recognized columns: program, course code, course title, description. Subjects are NOT campus-specific — the same BA Political Science curriculum applies to every PSU campus."
        endpoint="/api/upload/subjects"
        templates={[
          { label: "subjects_template.xlsx", href: "/templates/subjects_template.xlsx" },
          { label: "subjects_template.csv", href: "/templates/subjects_template.csv" },
        ]}
        extraFields={[
          { name: "program", label: "Program override", placeholder: "e.g. BA Political Science (only if file has no 'program' column)" },
        ]}
      />
      <FileCard
        title="2. Paid / Subscribed eBooks (Perlego, Kavita)"
        hint="Subscription-based eBook lists. Accepts .xlsx, .xls, .csv, .pdf, .docx. Auto-detects publication_title, first_author, publisher_name, year, online_identifier."
        endpoint="/api/upload/ebook_paid"
        templates={[
          { label: "ebooks_paid_template.xlsx", href: "/templates/ebooks_paid_template.xlsx" },
          { label: "ebooks_paid_template.csv",  href: "/templates/ebooks_paid_template.csv" },
        ]}
      />
      <FileCard
        title="3. Open Source eBooks"
        hint="Open Access eBook lists (OAPEN, DOAB, etc.). Same recognized columns as the paid template."
        endpoint="/api/upload/ebook_open"
        templates={[
          { label: "ebooks_open_template.xlsx", href: "/templates/ebooks_open_template.xlsx" },
          { label: "ebooks_open_template.csv",  href: "/templates/ebooks_open_template.csv" },
        ]}
      />
      <FileCard
        title="4. Printed Books"
        hint="Library catalog rows for printed books. Campus-specific. The campus you set here applies to every row UNLESS the file has a Campus column (per-row campus wins). Recognized columns: Call No., Author, Title, Year, Copies, Publisher, optional Campus."
        endpoint="/api/upload/book_printed"
        templates={[
          { label: "printed_books_template.xlsx", href: "/templates/printed_books_template.xlsx" },
          { label: "printed_books_template.csv",  href: "/templates/printed_books_template.csv" },
        ]}
        extraFields={[
          { name: "campus", label: "Campus (applied if no Campus column)", type: "campus" },
        ]}
      />
      <FileCard
        title="5. Printed Journals"
        hint="Print journal subscriptions. Campus-specific. Per-row Campus column wins over the dropdown. Recognized columns: Call No., Title, ISSN, Author/Editor, Year, Copies, Publisher, optional Campus."
        endpoint="/api/upload/journal_printed"
        templates={[
          { label: "journals_printed_template.xlsx", href: "/templates/journals_printed_template.xlsx" },
          { label: "journals_printed_template.csv",  href: "/templates/journals_printed_template.csv" },
        ]}
        extraFields={[
          { name: "campus", label: "Campus (applied if no Campus column)", type: "campus" },
        ]}
      />
      <FileCard
        title="6. Subscribed Online Journals"
        hint="Subscription-based online journals / databases. Recognized columns: Title, ISSN, Publisher, Year, URL."
        endpoint="/api/upload/journal_online_paid"
        templates={[
          { label: "journals_online_paid_template.xlsx", href: "/templates/journals_online_paid_template.xlsx" },
          { label: "journals_online_paid_template.csv",  href: "/templates/journals_online_paid_template.csv" },
        ]}
      />
      <FileCard
        title="7. Open Source Online Journals"
        hint="Open Access online journals (DOAJ, etc.). Same recognized columns as the subscribed template."
        endpoint="/api/upload/journal_online_open"
        templates={[
          { label: "journals_online_open_template.xlsx", href: "/templates/journals_online_open_template.xlsx" },
          { label: "journals_online_open_template.csv",  href: "/templates/journals_online_open_template.csv" },
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
