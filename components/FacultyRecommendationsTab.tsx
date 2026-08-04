"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { useAuth } from "@/components/AuthProvider";
import type { TitleRecommendationRow } from "@/app/api/title-recommendations/route";
import type { ProcurementRow } from "@/app/api/procurement/route";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  sourced: "bg-emerald-100 text-emerald-700",
  declined: "bg-slate-200 text-slate-600",
};

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
  return d.toLocaleDateString();
}

/** Lets a faculty member recommend a specific title for a course they
 *  teach -- a concrete starting point for Market Canvassing and for
 *  suppliers browsing needs (see /api/supplier/needs), rather than staff
 *  and suppliers only ever seeing a generic "needs N more titles" gap.
 *  Faculty submit and see everything (so they don't duplicate a
 *  suggestion someone else already made); reviewing/marking status is
 *  restricted to whoever can edit Market Canvassing (or admin). */
export default function FacultyRecommendationsTab() {
  const { perms } = usePermissions();
  const { user } = useAuth();
  const canReview = perms.isAdmin || !!perms.tabs["canvassing"]?.can_edit;

  const [subjects, setSubjects] = useState<ProcurementRow[]>([]);
  const [rows, setRows] = useState<TitleRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "sourced" | "declined">("all");

  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publisher, setPublisher] = useState("");
  const [year, setYear] = useState("");
  const [isbn, setIsbn] = useState("");
  const [formatPreference, setFormatPreference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setErr(null);
    Promise.all([
      apiFetch("/api/procurement").then((r) => r.json()),
      apiFetch("/api/title-recommendations").then((r) => r.json()),
    ])
      .then(([subRes, recRes]) => {
        if (subRes.error) throw new Error(subRes.error);
        if (recRes.error) throw new Error(recRes.error);
        setSubjects(subRes.rows ?? []);
        setRows(recRes.rows ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const subjectsByProgram = useMemo(() => {
    const map = new Map<string, ProcurementRow[]>();
    for (const s of subjects) {
      if (!map.has(s.program)) map.set(s.program, []);
      map.get(s.program)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [subjects]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectId || !title.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/title-recommendations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: Number(subjectId), title, author, publisher, year, isbn,
          format_preference: formatPreference, notes,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setTitle(""); setAuthor(""); setPublisher(""); setYear(""); setIsbn(""); setFormatPreference(""); setNotes("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(id: number, status: string) {
    setBusyId(id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/title-recommendations/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r: TitleRecommendationRow) {
    if (!confirm(`Remove recommendation "${r.title}"?`)) return;
    setBusyId(r.id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/title-recommendations/${r.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const displayed = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-4">
      {perms.tabs["faculty-recommendations"]?.can_edit && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-1">Recommend a Title</h2>
          <p className="text-xs text-slate-500 mb-3">
            Suggest a specific book for a course you teach -- this becomes a starting point for Market
            Canvassing and is shown to suppliers browsing what's needed, instead of just a generic gap count.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Course</span>
              <select className="input w-full max-w-md" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                <option value="">— select a course —</option>
                {subjectsByProgram.map(([prog, subs]) => (
                  <optgroup key={prog} label={prog}>
                    {subs.map((s) => (
                      <option key={s.subject_id} value={s.subject_id}>{s.course_code} — {s.course_title}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Title *</span>
                <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Author</span>
                <input className="input w-full" value={author} onChange={(e) => setAuthor(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Publisher</span>
                <input className="input w-full" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Year</span>
                <input className="input w-full" value={year} onChange={(e) => setYear(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">ISBN</span>
                <input className="input w-full" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Format preference</span>
                <select className="input w-full" value={formatPreference} onChange={(e) => setFormatPreference(e.target.value)}>
                  <option value="">Either is fine</option>
                  <option value="printed">Printed preferred</option>
                  <option value="ebook">eBook preferred</option>
                </select>
              </label>
            </div>
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Notes</span>
              <textarea className="input w-full h-16 resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this title, edition notes, etc." />
            </label>
            {err && <p className="text-red-700 text-sm">{err}</p>}
            <button type="submit" className="btn text-sm" disabled={submitting || !subjectId || !title.trim()}>
              {submitting ? "Submitting…" : "Submit Recommendation"}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-psu font-semibold">Recommendations</h2>
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            Status:
            <select className="input text-xs py-1" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="sourced">Sourced</option>
              <option value="declined">Declined</option>
            </select>
          </label>
        </div>
        {err && !perms.tabs["faculty-recommendations"]?.can_edit && <p className="text-red-700 text-sm mb-2">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">Program</th>
                  <th className="py-1 pr-2">Course</th>
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Format</th>
                  <th className="py-1 pr-2">Recommended by</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1 pl-2">When</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((r) => {
                  const isOwnerPending = r.recommended_by === user?.email && r.status === "pending";
                  return (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                      <td className="py-1.5 pr-2">{r.subject_label}</td>
                      <td className="py-1.5 pr-2 font-medium">{r.title}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.author}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{r.format_preference || "—"}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{r.recommended_by}</td>
                      <td className="py-1.5 pr-2">
                        {canReview ? (
                          <select
                            className="input text-[11px] py-0.5"
                            value={r.status} disabled={busyId === r.id}
                            onChange={(e) => setStatus(r.id, e.target.value)}
                          >
                            <option value="pending">Pending</option>
                            <option value="sourced">Sourced</option>
                            <option value="declined">Declined</option>
                          </select>
                        ) : (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(r.created_at).toLocaleString()}>
                        {formatWhen(r.created_at)}
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        {(canReview || isOwnerPending) && (
                          <button className="text-red-600 text-[11px] underline" disabled={busyId === r.id} onClick={() => remove(r)}>Remove</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {displayed.length === 0 && (
                  <tr><td colSpan={9} className="py-3 text-slate-400">No recommendations yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
