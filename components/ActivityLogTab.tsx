"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ActivityRow } from "@/app/api/activity/route";

const ACTION_LABEL: Record<string, string> = {
  upload_titles: "Upload (titles)",
  upload_subjects: "Upload (subjects)",
  sync_destiny: "Synced from Destiny",
  match_run: "Match run",
  bulk_delete: "Bulk delete",
  hostinger_migrate: "Migrated to Hostinger",
  program_create: "Program created",
  program_rename: "Program renamed",
  program_delete: "Program deleted",
  program_merge: "Programs merged",
  program_cost_estimate: "Cost estimate set",
  subject_create: "Course added",
  subject_edit: "Course edited",
  subject_lock: "Course locked",
  subject_unlock: "Course unlocked",
  subject_merge: "Courses merged",
  title_merge: "Titles combined",
  assignment_add: "Title added to course",
  assignment_remove: "Title removed from course",
  role_create: "Role created",
  role_delete: "Role deleted",
  role_permission_edit: "Role permissions changed",
  user_role_assign: "User access assigned",
  user_role_remove: "User access removed",
  user_campus_scope_edit: "User campus access changed",
  supplier_offer_submit: "Supplier offer submitted",
  supplier_offer_decide: "Supplier offer decided",
  purchase_request_generate: "Purchase request generated",
  purchase_request_edit: "Purchase request edited",
  purchase_request_cancel: "Purchase request cancelled",
  pr_workflow_step_create: "PR workflow office added",
  pr_workflow_step_edit: "PR workflow office edited",
  pr_workflow_step_delete: "PR workflow office removed",
  pr_advance: "Purchase request status updated",
  campus_budget_set: "Campus budget set",
  purchase_order_generate: "Purchase order generated",
  purchase_order_edit: "Purchase order edited",
  purchase_order_cancel: "Purchase order cancelled",
  canvassing_price_reverify: "Canvassed price re-verified",
  title_recommendation_submit: "Faculty title recommendation submitted",
  title_recommendation_status: "Faculty title recommendation status changed",
  title_recommendation_delete: "Faculty title recommendation removed",
};

function actionColor(action: string): string {
  if (action === "bulk_delete" || action.endsWith("_delete")) return "bg-red-100 text-red-700";
  if (action.startsWith("upload_") || action === "sync_destiny") return "bg-blue-100 text-blue-700";
  if (action === "match_run") return "bg-purple-100 text-purple-700";
  if (action.includes("lock")) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ActivityLogTab() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reverting, setReverting] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (before?: string) => {
    const p = new URLSearchParams();
    if (before) p.set("before", before);
    const res = await apiFetch(`/api/activity?${p}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    return (j.activity ?? []) as ActivityRow[];
  }, []);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    load()
      .then((r) => { setRows(r); setHasMore(r.length > 0); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function loadMore() {
    if (!rows.length) return;
    setLoadingMore(true);
    try {
      const more = await load(rows[rows.length - 1].created_at);
      setRows((prev) => [...prev, ...more]);
      setHasMore(more.length > 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function revert(row: ActivityRow) {
    if (!confirm(`Revert this upload? This deletes everything it added:\n\n"${row.summary}"\n\nThis can't be undone.`)) return;
    setReverting(row.id);
    setErr(null);
    try {
      const res = await apiFetch("/api/activity/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity_id: row.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      // Refresh from the top so the new "Reverted upload" entry shows up too.
      setLoading(true);
      const fresh = await load();
      setRows(fresh);
      setHasMore(fresh.length > 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReverting(null);
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">Activity Log</h2>
      <p className="text-xs text-slate-500 mb-4">
        Recent uploads and changes across the app, newest first. Uploads that added new rows can be reverted —
        this deletes exactly what that upload added and nothing else.
      </p>

      {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-slate-500 text-sm">No activity recorded yet.</p>}

      {!loading && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="border border-slate-200 rounded p-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={"text-[10px] px-1.5 py-0.5 rounded font-medium " + actionColor(r.action)}>
                    {ACTION_LABEL[r.action] ?? r.action}
                  </span>
                  <span className="text-xs text-slate-400">{formatWhen(r.created_at)}</span>
                  {r.user_email && <span className="text-xs text-slate-400">· {r.user_email}</span>}
                  {r.reverted_at && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-200 text-slate-600">Reverted</span>
                  )}
                </div>
                <p className="text-sm text-slate-700 break-words">{r.summary}</p>
              </div>
              {r.revertible && !r.reverted_at && (
                <button
                  className="btn-outline text-xs whitespace-nowrap shrink-0"
                  disabled={reverting === r.id}
                  onClick={() => revert(r)}
                >
                  {reverting === r.id ? "Reverting…" : "Revert"}
                </button>
              )}
            </div>
          ))}
          {hasMore && (
            <div className="text-center pt-2">
              <button className="btn-outline text-xs" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
