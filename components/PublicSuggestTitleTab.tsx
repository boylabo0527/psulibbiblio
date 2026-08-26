"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { SubjectSummaryRow } from "@/app/api/dashboard/subjects/route";

type DraftTitle = {
  title: string; author: string; publisher: string; year: string; isbn: string;
  format_preference: string; notes: string; price_estimate: string;
};
function emptyDraftTitle(): DraftTitle {
  return { title: "", author: "", publisher: "", year: "", isbn: "", format_preference: "", notes: "", price_estimate: "" };
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
  const [subjectId, setSubjectId] = useState("");
  const [titles, setTitles] = useState<DraftTitle[]>([emptyDraftTitle()]);
  const [submitterRole, setSubmitterRole] = useState("");
  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot -- stays empty for a real person
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

  // A single native <select> listing every course, grouped by program with
  // <optgroup> -- on a phone this opens the OS's own large touch-friendly
  // picker instead of a small custom list fighting the on-screen keyboard
  // (what made finding a course here hard to use on mobile), and unlike a
  // Program-then-Course cascade, every course is visible right away instead
  // of being gated behind picking a program first.
  const subjectGroups = useMemo(() => {
    const map = new Map<string, SubjectSummaryRow[]>();
    for (const s of subjects) {
      if (!map.has(s.program)) map.set(s.program, []);
      map.get(s.program)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([program, subs]) => ({ program, subs: subs.sort((a, b) => a.sort_order - b.sort_order) }));
  }, [subjects]);

  function setTitleField(i: number, field: keyof DraftTitle, value: string) {
    setTitles((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  }
  function addTitleRow() {
    setTitles((prev) => [...prev, emptyDraftTitle()]);
  }
  function removeTitleRow(i: number) {
    setTitles((prev) => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i));
  }

  const validTitles = titles.filter((t) => t.title.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectId || validTitles.length === 0 || !submitterRole) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/title-recommendations/public", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: Number(subjectId),
          titles: validTitles.map((t) => ({
            title: t.title, author: t.author, publisher: t.publisher, year: t.year, isbn: t.isbn,
            format_preference: t.format_preference, notes: t.notes,
            price_estimate: t.price_estimate.trim() ? Number(t.price_estimate) : null,
          })),
          submitter_role: submitterRole, submitter_name: submitterName, submitter_email: submitterEmail,
          website,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setDone(true);
      setSubjectId(""); setTitles([emptyDraftTitle()]);
      setSubmitterRole(""); setSubmitterName(""); setSubmitterEmail(""); setWebsite("");
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
                <select className="input w-full" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">Select a course…</option>
                  {subjectGroups.map((g) => (
                    <optgroup key={g.program} label={g.program}>
                      {g.subs.map((s) => (
                        <option key={s.subject_id} value={s.subject_id}>{s.course_code} — {s.course_title}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <div className="space-y-3">
                {titles.map((t, i) => (
                  <div key={i} className="border border-slate-200 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-500">Title {i + 1}</span>
                      {titles.length > 1 && (
                        <button type="button" className="text-red-500 text-[11px] underline" onClick={() => removeTitleRow(i)}>Remove</button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="label flex-col items-start gap-1">
                        <span className="text-xs">Title *</span>
                        <input className="input w-full" value={t.title} onChange={(e) => setTitleField(i, "title", e.target.value)} />
                      </label>
                      <label className="label flex-col items-start gap-1">
                        <span className="text-xs">Author</span>
                        <input className="input w-full" value={t.author} onChange={(e) => setTitleField(i, "author", e.target.value)} />
                      </label>
                      <label className="label flex-col items-start gap-1">
                        <span className="text-xs">Publisher</span>
                        <input className="input w-full" value={t.publisher} onChange={(e) => setTitleField(i, "publisher", e.target.value)} />
                      </label>
                      <label className="label flex-col items-start gap-1">
                        <span className="text-xs">Year</span>
                        <input className="input w-full" value={t.year} onChange={(e) => setTitleField(i, "year", e.target.value)} />
                      </label>
                      <label className="label flex-col items-start gap-1">
                        <span className="text-xs">ISBN</span>
                        <input className="input w-full" value={t.isbn} onChange={(e) => setTitleField(i, "isbn", e.target.value)} />
                      </label>
                      <label className="label flex-col items-start gap-1">
                        <span className="text-xs">Format preference</span>
                        <select className="input w-full" value={t.format_preference} onChange={(e) => setTitleField(i, "format_preference", e.target.value)}>
                          <option value="">Either is fine</option>
                          <option value="printed">Printed preferred</option>
                          <option value="ebook">eBook preferred</option>
                        </select>
                      </label>
                      <label className="label flex-col items-start gap-1">
                        <span className="text-xs">Price estimate (₱)</span>
                        <input type="number" min="0" step="0.01" className="input w-full" value={t.price_estimate} onChange={(e) => setTitleField(i, "price_estimate", e.target.value)} placeholder="Optional ballpark cost" />
                      </label>
                    </div>
                    <label className="label flex-col items-start gap-1 mt-3">
                      <span className="text-xs">Notes</span>
                      <textarea className="input w-full h-14 resize-none" value={t.notes} onChange={(e) => setTitleField(i, "notes", e.target.value)} placeholder="Why this title, edition notes, etc." />
                    </label>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-outline text-xs" onClick={addTitleRow}>+ Add another title</button>

              <div className="border-t border-slate-200 pt-3">
                <label className="label flex-col items-start gap-1 mb-3">
                  <span className="text-xs">I am a *</span>
                  <select className="input w-full sm:w-56" value={submitterRole} onChange={(e) => setSubmitterRole(e.target.value)}>
                    <option value="">Select one…</option>
                    <option value="Faculty">Faculty</option>
                    <option value="Student">Student</option>
                    <option value="Staff">Staff</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <p className="text-xs text-slate-500 mb-2">Name and email are optional -- lets staff follow up with you about this suggestion.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="label flex-col items-start gap-1">
                    <span className="text-xs">Your name</span>
                    <input className="input w-full" value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} />
                  </label>
                  <label className="label flex-col items-start gap-1">
                    <span className="text-xs">Your email</span>
                    <input type="email" className="input w-full" value={submitterEmail} onChange={(e) => setSubmitterEmail(e.target.value)} />
                  </label>
                </div>
              </div>

              {/* Honeypot -- invisible and unreachable by keyboard for a real
                  visitor, but a form-filling bot has no way to know that. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                <label>
                  Website
                  <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>

              {err && <p className="text-red-700 text-sm">{err}</p>}
              <button type="submit" className="btn text-sm" disabled={submitting || !subjectId || validTitles.length === 0 || !submitterRole}>
                {submitting ? "Submitting…" : validTitles.length > 1 ? `Submit ${validTitles.length} Suggestions` : "Submit Suggestion"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
