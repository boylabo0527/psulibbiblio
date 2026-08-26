"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import SearchableSelect from "@/components/SearchableSelect";
import type { SubjectSummaryRow } from "@/app/api/dashboard/subjects/route";

type Draft = {
  subjectId: string; title: string; author: string; publisher: string; year: string; isbn: string;
  format_preference: string; notes: string; price_estimate: string;
  submitter_name: string; submitter_email: string;
  website: string; // honeypot -- stays empty for a real person
};

function emptyDraft(): Draft {
  return {
    subjectId: "", title: "", author: "", publisher: "", year: "", isbn: "",
    format_preference: "", notes: "", price_estimate: "",
    submitter_name: "", submitter_email: "", website: "",
  };
}

/** A no-sign-in-required version of Faculty Recommendations' submission
 *  form, for a faculty/staff member who wants to suggest a title without
 *  going through Google OAuth first -- feeds the exact same pending-review
 *  queue Market Canvassing staff already work from (see
 *  /api/title-recommendations/public), just flagged so reviewers know it
 *  came in anonymously. */
export default function PublicSuggestTitleTab() {
  const [subjects, setSubjects] = useState<SubjectSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiFetch("/api/dashboard/subjects")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setSubjects(j.subjects ?? []);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const courseGroups = useMemo(() => {
    const byProgram = new Map<string, SubjectSummaryRow[]>();
    for (const s of subjects) {
      if (!byProgram.has(s.program)) byProgram.set(s.program, []);
      byProgram.get(s.program)!.push(s);
    }
    return Array.from(byProgram.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, subs]) => ({
        label,
        options: subs.map((s) => ({ value: String(s.subject_id), label: `${s.course_code} — ${s.course_title}` })),
      }));
  }, [subjects]);

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.subjectId || !draft.title.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/title-recommendations/public", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: Number(draft.subjectId), title: draft.title, author: draft.author,
          publisher: draft.publisher, year: draft.year, isbn: draft.isbn,
          format_preference: draft.format_preference, notes: draft.notes,
          price_estimate: draft.price_estimate.trim() ? Number(draft.price_estimate) : null,
          submitter_name: draft.submitter_name, submitter_email: draft.submitter_email,
          website: draft.website,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setDone(true);
      setDraft(emptyDraft());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card max-w-2xl mx-auto">
      <h2 className="text-psu font-semibold mb-1">Suggest a Title</h2>
      <p className="text-xs text-slate-500 mb-4">
        Recommend a book for a course -- no sign-in needed. Market Canvassing staff review every suggestion here
        before anything is purchased, the same as titles submitted through the faculty account-based form.
      </p>

      {done && (
        <div className="bg-emerald-50 border border-emerald-200 rounded p-3 mb-4">
          <p className="text-emerald-800 text-sm font-medium">Thanks! Your suggestion has been submitted for review.</p>
          <button className="text-emerald-700 text-xs underline mt-1" onClick={() => setDone(false)}>Suggest another title</button>
        </div>
      )}

      {!done && (
        <>
          {loadErr && <p className="text-red-700 text-sm mb-2">{loadErr}</p>}
          {loading && <p className="text-slate-500 text-sm">Loading course list…</p>}
          {!loading && (
            <form onSubmit={submit} className="space-y-3">
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Course *</span>
                <SearchableSelect
                  value={draft.subjectId}
                  onChange={(v) => set("subjectId", v)}
                  groups={courseGroups}
                  placeholder="Type to search a course…"
                  className="input w-full"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="label flex-col items-start gap-1">
                  <span className="text-xs">Title *</span>
                  <input className="input w-full" value={draft.title} onChange={(e) => set("title", e.target.value)} />
                </label>
                <label className="label flex-col items-start gap-1">
                  <span className="text-xs">Author</span>
                  <input className="input w-full" value={draft.author} onChange={(e) => set("author", e.target.value)} />
                </label>
                <label className="label flex-col items-start gap-1">
                  <span className="text-xs">Publisher</span>
                  <input className="input w-full" value={draft.publisher} onChange={(e) => set("publisher", e.target.value)} />
                </label>
                <label className="label flex-col items-start gap-1">
                  <span className="text-xs">Year</span>
                  <input className="input w-full" value={draft.year} onChange={(e) => set("year", e.target.value)} />
                </label>
                <label className="label flex-col items-start gap-1">
                  <span className="text-xs">ISBN</span>
                  <input className="input w-full" value={draft.isbn} onChange={(e) => set("isbn", e.target.value)} />
                </label>
                <label className="label flex-col items-start gap-1">
                  <span className="text-xs">Format preference</span>
                  <select className="input w-full" value={draft.format_preference} onChange={(e) => set("format_preference", e.target.value)}>
                    <option value="">Either is fine</option>
                    <option value="printed">Printed preferred</option>
                    <option value="ebook">eBook preferred</option>
                  </select>
                </label>
                <label className="label flex-col items-start gap-1">
                  <span className="text-xs">Price estimate (₱)</span>
                  <input type="number" min="0" step="0.01" className="input w-full" value={draft.price_estimate} onChange={(e) => set("price_estimate", e.target.value)} placeholder="Optional ballpark cost" />
                </label>
              </div>
              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Notes</span>
                <textarea className="input w-full h-14 resize-none" value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Why this title, edition notes, etc." />
              </label>

              <div className="border-t border-slate-200 pt-3">
                <p className="text-xs text-slate-500 mb-2">Optional -- lets staff follow up with you about this suggestion.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="label flex-col items-start gap-1">
                    <span className="text-xs">Your name</span>
                    <input className="input w-full" value={draft.submitter_name} onChange={(e) => set("submitter_name", e.target.value)} />
                  </label>
                  <label className="label flex-col items-start gap-1">
                    <span className="text-xs">Your email</span>
                    <input type="email" className="input w-full" value={draft.submitter_email} onChange={(e) => set("submitter_email", e.target.value)} />
                  </label>
                </div>
              </div>

              {/* Honeypot -- invisible and unreachable by keyboard for a real
                  visitor, but a form-filling bot has no way to know that. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                <label>
                  Website
                  <input type="text" tabIndex={-1} autoComplete="off" value={draft.website} onChange={(e) => set("website", e.target.value)} />
                </label>
              </div>

              {err && <p className="text-red-700 text-sm">{err}</p>}
              <button type="submit" className="btn text-sm" disabled={submitting || !draft.subjectId || !draft.title.trim()}>
                {submitting ? "Submitting…" : "Submit Suggestion"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
