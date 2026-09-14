"use client";
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

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
  const activeJobRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** The CSV this tool needs isn't produced anywhere else -- Programs &
   *  Export's own download is per-program (or a few combined via
   *  combine_with). This hits /api/export with program_id=all, which folds
   *  every program into one combined report the same way combine_with
   *  does, so every row -- including journals -- already carries the
   *  right Program column for the check above to route it by. */
  async function exportAll() {
    setExportBusy(true);
    setExportErr(null);
    try {
      const res = await apiFetch("/api/export?program_id=all&fmt=csv");
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
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch("/api/validate-csv/start", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      const payload: ValidatePayload = {
        programsTotal: j.programsTotal, programsScanned: 0, unknownPrograms: j.unknownPrograms ?? [],
        applyTotal: 0, applyDone: 0, locked: 0, removed: 0, lockedSkippedCount: 0, unresolvedCount: 0,
        sample: { confirmed: [], toRemove: [], lockedSkipped: [], unresolved: [] },
      };
      setState({ status: "running", jobId: j.jobId, payload });
      await pollUntilDone(j.jobId);
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
  const label = !p ? "" :
    state.status === "error" ? `Error: ${state.error}` :
    state.status === "done" ? (
      p.programsTotal === 0 ? "Nothing to check -- no rows in the file resolved to a real program."
        : `Done -- ${p.programsTotal} program(s) checked, ${p.locked} match(es) locked, ${p.removed} removed`
    ) :
    scanning ? `Checking programs… ${p.programsScanned} / ${p.programsTotal}`
      : `Applying changes… ${p.applyDone} / ${p.applyTotal}`;
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
