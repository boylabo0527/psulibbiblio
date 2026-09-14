"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";
import { parseSheetRows, isSpreadsheet, buildValidationRowsFromRaw } from "@/lib/parse-client";

type ValidateSampleRow = { program: string; course: string; title: string };
type ValidatePayload = {
  programsTotal: number; programsScanned: number; unknownPrograms: string[];
  applyTotal: number; applyDone: number;
  locked: number; removed: number; lockedSkippedCount: number; unresolvedCount: number;
  sample: {
    confirmed: ValidateSampleRow[]; toRemove: ValidateSampleRow[];
    lockedSkipped: ValidateSampleRow[]; unresolved: ValidateSampleRow[];
  };
};

type State =
  | { status: "idle" }
  | { status: "running" | "done" | "error"; jobId: string; payload: ValidatePayload; error?: string };

/** Validate Matches CSV, but for every program the uploaded file mentions
 *  (via its own Program column) at once, instead of one chosen program at
 *  a time -- see /api/validate-csv/start and lib/validate-jobs.ts. Runs as
 *  a resumable background job (same reasoning as the Destiny sync above):
 *  checking every program in a large file, each its own handful of
 *  Supabase round trips, then applying every resulting lock/removal,
 *  easily adds up to more work than fits in one request on a free-tier
 *  timeout, so it's chipped away at across many short /continue calls
 *  instead, with progress persisted between them. */
export default function ValidateAllProgramsAdmin() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  // Starts with everything on, same convention as the Materials filter in
  // Programs & Export -- the default export is unchanged (every type)
  // until someone actually narrows it.
  const [enabledTypes, setEnabledTypes] = useState<Set<ResourceTypeId>>(
    () => new Set(RESOURCE_TYPES.map((t) => t.id)),
  );
  const activeJobRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // A single program with a lot of subjects/assignments can eat a whole
  // /continue call's time budget without programsScanned moving at all --
  // that's still real progress, not a hang, but the progress bar alone
  // can't tell the two apart. These timestamps back a "last response Ns
  // ago" heartbeat so it's visible either way: it keeps resetting near 0
  // while a poll is actually landing, and only grows if one truly stalls.
  const startedAtRef = useRef<number | null>(null);
  const lastPolledAtRef = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  function toggleType(id: ResourceTypeId) {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The CSV this tool needs isn't produced anywhere else -- Programs &
   *  Export's own download is per-program (or a few combined via
   *  combine_with). This hits /api/export with program_id=all, which folds
   *  every program into one combined report the same way combine_with
   *  does, so every row -- including journals -- already carries the
   *  right Program column for the check above to route it by. Only sent
   *  when narrowed to a strict subset of every type, same as Programs &
   *  Export's own typesParam -- with everything checked, omitting it
   *  entirely keeps the request identical to before this filter existed. */
  async function exportAll() {
    setExportBusy(true);
    setExportErr(null);
    try {
      const p = new URLSearchParams({ program_id: "all", fmt: "csv" });
      if (enabledTypes.size < RESOURCE_TYPES.length) p.set("types", Array.from(enabledTypes).join(","));
      const res = await apiFetch(`/api/export?${p.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = text || `HTTP ${res.status}`;
        try { message = JSON.parse(text).error ?? message; } catch { /* not JSON */ }
        throw new Error(message);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `all_programs_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }

  const MAX_CONSECUTIVE_FAILURES = 5;
  async function pollUntilDone(jobId: string) {
    activeJobRef.current = jobId;
    let consecutiveFailures = 0;
    for (;;) {
      if (activeJobRef.current !== jobId) return;
      let res: Response;
      try {
        res = await apiFetch("/api/validate-csv/continue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        lastPolledAtRef.current = Date.now();
        setNow(Date.now());
      } catch (e) {
        consecutiveFailures++;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          setState((s) => (s.status !== "idle" && s.jobId === jobId ? { ...s, status: "error", error: e instanceof Error ? e.message : String(e) } : s));
          return;
        }
        await new Promise((r) => setTimeout(r, 1000 * consecutiveFailures));
        continue;
      }
      if (res.status === 504 || res.status === 502 || res.status === 503) {
        consecutiveFailures++;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          setState((s) => (s.status !== "idle" && s.jobId === jobId ? { ...s, status: "error", error: `HTTP ${res.status} (gave up after ${MAX_CONSECUTIVE_FAILURES} retries)` } : s));
          return;
        }
        await new Promise((r) => setTimeout(r, 1000 * consecutiveFailures));
        continue;
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setState((s) => (s.status !== "idle" && s.jobId === jobId ? { ...s, status: "error", error: j.error || `HTTP ${res.status}` } : s));
        return;
      }
      consecutiveFailures = 0;
      setState({ status: j.done ? "done" : "running", jobId, payload: j.payload });
      if (j.done) return;
    }
  }

  async function start() {
    if (!file) return;
    setState({ status: "idle" });
    startedAtRef.current = Date.now();
    lastPolledAtRef.current = Date.now();
    setNow(Date.now());
    try {
      // Parse in the browser and send just the few fields validation
      // actually needs (course_code/program/title/isbn/verdict), not
      // every export column -- a CSV covering every program can be large
      // enough in its full multi-column form to land close to (or over) a
      // serverless function's request body limit. Same reasoning as the
      // batched upload in UploadTab.tsx, minus the batching: this file's
      // rows, narrowed to those few fields, are already far smaller than
      // the original.
      let res: Response;
      if (isSpreadsheet(file)) {
        const rows = buildValidationRowsFromRaw(await parseSheetRows(file));
        res = await apiFetch("/api/validate-csv/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
      } else {
        const fd = new FormData();
        fd.append("file", file);
        res = await apiFetch("/api/validate-csv/start", { method: "POST", body: fd });
      }
      const text = await res.text().catch(() => "");
      let j: { jobId?: string; programsTotal?: number; unknownPrograms?: string[]; error?: string } = {};
      try { j = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
      if (!res.ok || j.error || !j.jobId) {
        const message = typeof j.error === "string" && j.error ? j.error : (text || `HTTP ${res.status}`);
        throw new Error(message);
      }
      const jobId = j.jobId;
      const payload: ValidatePayload = {
        programsTotal: j.programsTotal ?? 0, programsScanned: 0, unknownPrograms: j.unknownPrograms ?? [],
        applyTotal: 0, applyDone: 0, locked: 0, removed: 0, lockedSkippedCount: 0, unresolvedCount: 0,
        sample: { confirmed: [], toRemove: [], lockedSkipped: [], unresolved: [] },
      };
      setState({ status: "running", jobId, payload });
      await pollUntilDone(jobId);
    } catch (e) {
      setState({ status: "error", jobId: "", payload: {
        programsTotal: 0, programsScanned: 0, unknownPrograms: [], applyTotal: 0, applyDone: 0,
        locked: 0, removed: 0, lockedSkippedCount: 0, unresolvedCount: 0,
        sample: { confirmed: [], toRemove: [], lockedSkipped: [], unresolved: [] },
      }, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const busy = state.status === "running";
  const p = state.status !== "idle" ? state.payload : null;
  const scanning = !!p && p.programsScanned < p.programsTotal;
  const secondsSince = (ref: number | null) => ref == null ? null : Math.max(0, Math.round((now - ref) / 1000));
  const sinceLastPoll = busy ? secondsSince(lastPolledAtRef.current) : null;
  const elapsed = busy ? secondsSince(startedAtRef.current) : null;
  // A poll landing (whatever it found) resets sinceLastPoll near 0 -- as
  // long as that keeps happening, the job is alive even while
  // programsScanned sits still on one big program. It only climbing
  // instead is the actual sign something's stuck: the current /continue
  // call hasn't come back yet well past when one normally would.
  const heartbeat = busy && sinceLastPoll != null
    ? (sinceLastPoll <= 12
        ? ` (still working -- checked in ${elapsed}s, last response ${sinceLastPoll}s ago)`
        : ` (waiting on a response -- ${sinceLastPoll}s since the last one; still fine unless this keeps climbing)`)
    : "";
  const label = !p ? "" :
    state.status === "error" ? `Error: ${state.error}` :
    state.status === "done" ? (
      p.programsTotal === 0 ? "Nothing to check -- no rows in the file resolved to a real program."
        : `Done -- ${p.programsTotal} program(s) checked, ${p.locked} match(es) locked, ${p.removed} removed`
    ) :
    (scanning ? `Checking programs… ${p.programsScanned} / ${p.programsTotal}`
      : `Applying changes… ${p.applyDone} / ${p.applyTotal}`) + heartbeat;
  const pct = !p ? 0 :
    scanning ? (p.programsTotal > 0 ? Math.round((p.programsScanned / p.programsTotal) * 100) : 0)
      : (p.applyTotal > 0 ? Math.round((p.applyDone / p.applyTotal) * 100) : 100);

  const renderSample = (rows: ValidateSampleRow[]) => rows.map((r, i) => (
    <tr key={i} className="border-b border-slate-100">
      <td className="py-1 pr-2">{r.program}</td>
      <td className="py-1 pr-2">{r.course}</td>
      <td className="py-1 pr-2">{r.title}</td>
    </tr>
  ));

  return (
    <div className="card border-amber-300">
      <h2 className="text-amber-700 font-semibold mb-2">Admin — Validate Matches CSV (All Programs)</h2>
      <p className="text-xs text-slate-500 mb-3">
        Upload one Programs &amp; Export CSV covering multiple programs (each row already carries its own
        Program column) and this checks -- and applies -- confirm/remove/lock across every program it mentions,
        in the background so a large file doesn&apos;t hit Vercel&apos;s free-plan request time limit. To check
        just one program without applying anything until you review it, use Validate Matches (CSV) above instead.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-xs text-slate-600 mr-1">Materials to export:</span>
        {RESOURCE_TYPES.map((t) => {
          const on = enabledTypes.has(t.id);
          return (
            <button
              key={t.id}
              className={
                "text-[11px] px-2 py-0.5 rounded-full border font-medium " +
                (on
                  ? "bg-psu-light text-psu border-psu"
                  : "text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600")
              }
              title={on ? `Leave ${t.uiLabel} out of the export` : `Include ${t.uiLabel} in the export`}
              onClick={() => toggleType(t.id)}
            >
              {t.uiLabel}
            </button>
          );
        })}
        <button className="text-[11px] text-psu underline ml-1" onClick={() => setEnabledTypes(new Set(RESOURCE_TYPES.map((t) => t.id)))}>
          All
        </button>
        <button className="text-[11px] text-slate-400 underline" onClick={() => setEnabledTypes(new Set())}>
          None
        </button>
        {enabledTypes.size === 0 && (
          <span className="text-xs text-amber-700 ml-1">No material types selected — the export will be empty.</span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button className="btn-outline text-xs" disabled={exportBusy} onClick={exportAll}>
          {exportBusy ? "Exporting…" : "⬇ Export CSV of every program"}
        </button>
        <span className="text-xs text-slate-500">Review/edit it, then upload the (same or edited) file below.</span>
      </div>
      {exportErr && <p className="text-red-700 text-xs mb-2">{exportErr}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileInputRef}
          type="file" accept=".csv,.xlsx,.xls"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
        <button className="btn text-xs" disabled={busy || !file} onClick={start}>
          {busy ? "Working…" : "Check & apply"}
        </button>
      </div>

      {p && (
        <div className="mt-3">
          <div className="w-full bg-slate-100 rounded h-2 overflow-hidden">
            <div
              className={"h-2 " + (state.status === "error" ? "bg-red-500" : "bg-psu")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-slate-600 mt-1">{label}</p>
          {p.unknownPrograms.length > 0 && (
            <p className="text-xs text-amber-700 mt-1">
              Program name{p.unknownPrograms.length === 1 ? "" : "s"} in the file not found in the system:{" "}
              {p.unknownPrograms.join(", ")}
            </p>
          )}
          {state.status === "done" && p.programsTotal > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              {p.lockedSkippedCount} already-locked match{p.lockedSkippedCount === 1 ? "" : "es"} kept as-is ·{" "}
              {p.unresolvedCount} row{p.unresolvedCount === 1 ? "" : "s"} in the file didn&apos;t match a current title.
            </p>
          )}
        </div>
      )}

      {p && (p.sample.confirmed.length > 0 || p.sample.toRemove.length > 0) && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1 pr-2">Program</th><th className="py-1 pr-2">Course</th><th className="py-1 pr-2">Title</th>
              </tr>
            </thead>
            <tbody>
              {p.sample.toRemove.length > 0 && (
                <tr><td colSpan={3} className="pt-2 pb-1 text-slate-500 italic">Removed (sample)</td></tr>
              )}
              {renderSample(p.sample.toRemove)}
              {p.sample.confirmed.length > 0 && (
                <tr><td colSpan={3} className="pt-2 pb-1 text-slate-500 italic">Locked (sample)</td></tr>
              )}
              {renderSample(p.sample.confirmed)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
