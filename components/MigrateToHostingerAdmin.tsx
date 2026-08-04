"use client";
import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Progress = {
  status: "idle" | "running" | "done" | "error";
  totalAtStart: number;
  migrated: number;
  remaining: number;
  error?: string;
};

const EMPTY: Progress = { status: "idle", totalAtStart: 0, migrated: 0, remaining: 0 };

/** Admin tool: moves eBook titles that have never been assigned to any
 *  subject out of Supabase and into the library's own Hostinger MySQL
 *  database (see lib/hostinger-mysql.ts), then deletes them from
 *  Supabase -- frees up Supabase's free-tier storage cap without losing
 *  the catalog, since the moved titles stay searchable from the Perlego
 *  Catalog tab. Runs in a loop of small batches from the browser, same
 *  reasoning as the Destiny sync: no single request should have to do
 *  hundreds of thousands of rows at once. */
export default function MigrateToHostingerAdmin() {
  const [preview, setPreview] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  async function loadPreview() {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/migrate-to-hostinger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "ebook_paid", dryRun: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setPreview(j.remaining);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (preview === null) return;
    if (!confirm(
      `Move ${preview.toLocaleString()} unmatched eBook titles to Hostinger MySQL and delete them from Supabase?\n\n` +
      `They'll stay searchable from the Perlego Catalog tab. This runs in the background and can take a while -- ` +
      `you can leave this page; it'll just stop where it is and you can resume by clicking Start again.`,
    )) return;
    cancelledRef.current = false;
    setBusy(true);
    setErr(null);
    setProgress({ status: "running", totalAtStart: preview, migrated: 0, remaining: preview });
    try {
      let migratedSoFar = 0;
      let consecutiveFailures = 0;
      for (;;) {
        if (cancelledRef.current) break;
        let res: Response;
        try {
          res = await apiFetch("/api/admin/migrate-to-hostinger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ format: "ebook_paid" }),
          });
        } catch (e) {
          consecutiveFailures++;
          if (consecutiveFailures > 5) throw e;
          await new Promise((r) => setTimeout(r, 1000 * consecutiveFailures));
          continue;
        }
        if (res.status === 504 || res.status === 502 || res.status === 503) {
          consecutiveFailures++;
          if (consecutiveFailures > 5) throw new Error(`HTTP ${res.status} (gave up after 5 retries)`);
          await new Promise((r) => setTimeout(r, 1000 * consecutiveFailures));
          continue;
        }
        const j = await res.json();
        if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
        consecutiveFailures = 0;
        migratedSoFar += j.migrated ?? 0;
        setProgress({ status: j.done ? "done" : "running", totalAtStart: preview, migrated: migratedSoFar, remaining: j.remaining ?? 0 });
        if (j.done) break;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setProgress((p) => ({ ...p, status: "error", error: message }));
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    cancelledRef.current = true;
  }

  return (
    <div className="card border-amber-300">
      <h2 className="text-amber-700 font-semibold mb-2">Admin — Migrate Unmatched eBooks to Hostinger</h2>
      <p className="text-xs text-slate-500 mb-3">
        Moves eBook titles that have never been assigned to any course out of Supabase (which has a free-tier
        storage limit) into your existing Hostinger MySQL database instead of deleting them. They stay searchable
        from the Perlego Catalog tab, just outside Match&apos;s candidate pool for new subjects until re-imported.
        Requires <code>HOSTINGER_DB_*</code> env vars set in Vercel, and the <code>perlego_titles</code> table
        already created on Hostinger (see the comment in lib/hostinger-mysql.ts for the SQL).
      </p>

      <div className="flex items-center gap-3">
        <button className="btn-outline text-sm" disabled={busy} onClick={loadPreview}>
          {busy && progress.status !== "running" ? "Checking…" : "Check how many"}
        </button>
        {preview !== null && progress.status !== "running" && (
          <>
            <span className="text-sm text-slate-600">
              {preview.toLocaleString()} unmatched eBook{preview === 1 ? "" : "s"} to move.
            </span>
            {preview > 0 && (
              <button className="btn bg-amber-600 hover:bg-amber-700 text-sm" disabled={busy} onClick={start}>
                Start migration
              </button>
            )}
          </>
        )}
        {progress.status === "running" && (
          <button className="btn-outline text-sm" onClick={stop}>Stop after this batch</button>
        )}
      </div>

      {progress.status !== "idle" && (
        <div className="mt-3 text-xs">
          {progress.status === "running" && (
            <div className="w-full bg-slate-200 rounded h-1.5 mb-1.5 overflow-hidden">
              <div
                className="bg-amber-600 h-full rounded transition-all"
                style={{ width: `${progress.totalAtStart > 0 ? Math.round((progress.migrated / progress.totalAtStart) * 100) : 0}%` }}
              />
            </div>
          )}
          <p className={progress.status === "error" ? "text-red-700" : progress.status === "done" ? "text-emerald-700" : "text-slate-600"}>
            {progress.status === "error" && `Error: ${progress.error}`}
            {progress.status === "running" && `Moving… ${progress.migrated.toLocaleString()} done, ${progress.remaining.toLocaleString()} left`}
            {progress.status === "done" && `Done — moved ${progress.migrated.toLocaleString()} title(s) to Hostinger.`}
          </p>
        </div>
      )}

      {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
    </div>
  );
}
