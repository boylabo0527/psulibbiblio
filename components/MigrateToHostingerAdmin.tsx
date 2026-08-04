"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";

type Progress = {
  jobId: string;
  status: "running" | "done" | "error";
  total: number;
  inserted: number;
  error?: string;
};

const FORMAT = "ebook_paid";
const MAX_CONSECUTIVE_FAILURES = 5;

/** Admin tool: moves eBook titles that have never been assigned to any
 *  subject out of Supabase and into the library's own Hostinger MySQL
 *  database (see lib/hostinger-mysql.ts), then deletes them from
 *  Supabase -- frees up Supabase's free-tier storage cap without losing
 *  the catalog, since the moved titles stay searchable from the Perlego
 *  Catalog tab.
 *
 *  Same start/continue/status architecture as the Destiny sync
 *  (DestinySyncCard in UploadTab.tsx): progress is persisted server-side
 *  in the sync_jobs table, not just in this component's state, so a page
 *  reload (or a request that times out mid-batch) doesn't lose track --
 *  on mount this checks /status for an already-running job and resumes
 *  watching it automatically instead of the admin having to guess. */
export default function MigrateToHostingerAdmin() {
  const { perms } = usePermissions();
  const [preview, setPreview] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const activeJobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!perms.isAdmin) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/admin/migrate-to-hostinger/status?format=${FORMAT}`);
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.jobId) {
          setProgress({ jobId: j.jobId, status: j.status, total: j.total, inserted: j.inserted, error: j.error });
          if (j.status === "running") pollUntilDone(j.jobId);
        }
      } catch {
        // Best-effort "resume watching a migration in progress" check --
        // fine to just show nothing if it fails.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms.isAdmin]);

  if (!perms.isAdmin) return null;

  async function pollUntilDone(jobId: string) {
    activeJobRef.current = jobId;
    setBusy(true);
    let consecutiveFailures = 0;
    try {
      for (;;) {
        if (activeJobRef.current !== jobId) return; // superseded by a newer run
        let res: Response;
        try {
          res = await apiFetch("/api/admin/migrate-to-hostinger/continue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
        } catch (e) {
          consecutiveFailures++;
          if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
            setProgress((p) => (p && p.jobId === jobId ? { ...p, status: "error", error: e instanceof Error ? e.message : String(e) } : p));
            return;
          }
          await new Promise((r) => setTimeout(r, 1000 * consecutiveFailures));
          continue;
        }
        if (res.status === 504 || res.status === 502 || res.status === 503) {
          consecutiveFailures++;
          if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
            setProgress((p) => (p && p.jobId === jobId ? { ...p, status: "error", error: `HTTP ${res.status} (gave up after ${MAX_CONSECUTIVE_FAILURES} retries)` } : p));
            return;
          }
          await new Promise((r) => setTimeout(r, 1000 * consecutiveFailures));
          continue;
        }
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          setProgress((p) => (p && p.jobId === jobId ? { ...p, status: "error", error: j.error || `HTTP ${res.status}` } : p));
          return;
        }
        consecutiveFailures = 0;
        setProgress({ jobId, status: j.done ? "done" : "running", total: j.total, inserted: j.inserted });
        if (j.done) return;
      }
    } finally {
      if (activeJobRef.current === jobId) setBusy(false);
    }
  }

  async function loadPreview() {
    setChecking(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/migrate-to-hostinger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: FORMAT, dryRun: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setPreview(j.total);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  async function start() {
    if (preview === null) return;
    if (!confirm(
      `Move ${preview.toLocaleString()} unmatched eBook titles to Hostinger MySQL and delete them from Supabase?\n\n` +
      `They'll stay searchable from the Perlego Catalog tab. This runs in the background and can take a while -- ` +
      `you can leave this page or reload it; progress is saved and it'll pick back up where it left off.`,
    )) return;
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/migrate-to-hostinger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: FORMAT }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setProgress({ jobId: j.jobId, status: "running", total: j.total, inserted: 0 });
      await pollUntilDone(j.jobId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.inserted / progress.total) * 100) : 0;

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
        <button className="btn-outline text-sm" disabled={checking || busy} onClick={loadPreview}>
          {checking ? "Checking…" : "Check how many"}
        </button>
        {preview !== null && progress?.status !== "running" && (
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
      </div>

      {progress && (
        <div className="mt-3 text-xs">
          {progress.status === "running" && (
            <div className="w-full bg-slate-200 rounded h-1.5 mb-1.5 overflow-hidden">
              <div className="bg-amber-600 h-full rounded transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className={progress.status === "error" ? "text-red-700" : progress.status === "done" ? "text-emerald-700" : "text-slate-600"}>
            {progress.status === "error" && `Error: ${progress.error}`}
            {progress.status === "running" && `Moving… ${progress.inserted.toLocaleString()} / ${progress.total.toLocaleString()} (${pct}%)`}
            {progress.status === "done" && `Done — moved ${progress.inserted.toLocaleString()} title(s) to Hostinger.`}
          </p>
        </div>
      )}

      {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
    </div>
  );
}
