"use client";
import { useRef, useState } from "react";
import { parseSheetRows, isSpreadsheet } from "@/lib/parse-client";
import { apiFetch } from "@/lib/api-client";
import { useCampuses } from "@/lib/use-campuses";
import { consumeNdjson, type ProgressEvent } from "@/lib/streaming";
import BulkDeleteAdmin from "@/components/BulkDeleteAdmin";

type FilePhase = ProgressEvent["phase"] | "idle" | "uploading" | "queued";

type FileStatus = {
  file: File;
  phase: FilePhase;
  inserted: number;
  skipped: number;
  total: number;
  programs?: number;
  duplicates?: number;
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

function FileCard({ title, hint, endpoint, templates, extraFields }: Props) {
  const [queue, setQueue] = useState<FileStatus[]>([]);
  // Mirrors `queue` for the worker loop below, which needs to see files
  // appended mid-run (React state updates aren't visible inside an
  // already-running async loop closure).
  const queueRef = useRef<FileStatus[]>([]);
  const cursorRef = useRef(0);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const campuses = useCampuses();

  function patchFile(index: number, patch: Partial<FileStatus>) {
    queueRef.current = queueRef.current.map((f, i) => i === index ? { ...f, ...patch } : f);
    setQueue(queueRef.current);
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
        let duplicates = 0;
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
            if (ev.phase === "deduping") {
              patchFile(index, { phase: "deduping" });
            } else if (ev.phase === "inserting") {
              patchFile(index, { phase: "inserting", inserted: inserted + ev.inserted, skipped: skipped + ev.skipped, total });
            } else if (ev.phase === "done") {
              inserted += ev.inserted;
              skipped += ev.skipped;
              duplicates += ev.duplicates ?? 0;
              patchFile(index, { phase: "inserting", inserted, skipped, duplicates, total });
            } else if (ev.phase === "error") {
              patchFile(index, { phase: "error", error: ev.error });
            }
          }, controller.signal);
        }
        patchFile(index, { phase: "done", inserted, skipped, duplicates, total, elapsedMs: Date.now() - startedAt });
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
          else if (ev.phase === "done") patchFile(index, { phase: "done", inserted: ev.inserted, skipped: ev.skipped, duplicates: ev.duplicates, total: ev.received, programs: ev.programs, elapsedMs: Date.now() - startedAt });
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

  // Processes queueRef from wherever the cursor left off, re-checking
  // queueRef.current.length on every iteration — so files appended to the
  // queue while this loop is already running (via onFilesSelected below)
  // get picked up instead of requiring a fresh, separate run that would
  // otherwise abort whatever was already uploading.
  async function runQueue(controller: AbortController) {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (cursorRef.current < queueRef.current.length) {
        if (controller.signal.aborted) break;
        const i = cursorRef.current;
        cursorRef.current++;
        const current = queueRef.current[i];
        if (current.phase !== "queued") continue;
        await uploadOne(current, i, controller);
      }
    } finally {
      runningRef.current = false;
    }
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newItems: FileStatus[] = files.map((f) => ({
      file: f, phase: "queued", inserted: 0, skipped: 0, total: 0, elapsedMs: 0,
    }));
    queueRef.current = [...queueRef.current, ...newItems];
    setQueue(queueRef.current);
    if (!abortRef.current) abortRef.current = new AbortController();
    runQueue(abortRef.current);
    e.target.value = "";
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    cursorRef.current = queueRef.current.length;
    queueRef.current = queueRef.current.map((f) =>
      f.phase === "queued" || f.phase === "uploading" || f.phase === "parsing" || f.phase === "parsed" || f.phase === "deduping" || f.phase === "inserting"
        ? { ...f, phase: "error", error: "Cancelled" }
        : f,
    );
    setQueue(queueRef.current);
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
              {campuses.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
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
            const updatedSuffix = fs.skipped > 0
              ? ` · ${fs.skipped.toLocaleString()} copy count${fs.skipped === 1 ? "" : "s"} updated`
              : "";
            const duplicateSuffix = fs.duplicates && fs.duplicates > 0
              ? ` · ${fs.duplicates.toLocaleString()} already-counted ${fs.duplicates === 1 ? "copy" : "copies"} skipped`
              : "";
            const label = ({
              idle: "Waiting…",
              queued: "Queued",
              uploading: "Reading file…",
              parsing: "Parsing rows…",
              parsed: `Parsed ${fs.total.toLocaleString()} rows — checking database…`,
              deduping: `Checking ${fs.total.toLocaleString()} rows against database…`,
              inserting: `Saving ${fs.inserted.toLocaleString()} / ${fs.total.toLocaleString()}${updatedSuffix}`,
              done: `Done — ${fs.inserted.toLocaleString()} new titles inserted${updatedSuffix}${duplicateSuffix}`,
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
      <BulkDeleteAdmin />
    </>
  );
}
