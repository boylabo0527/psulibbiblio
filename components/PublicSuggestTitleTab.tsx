"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useCampuses } from "@/lib/use-campuses";
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
  const [campus, setCampus] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [titles, setTitles] = useState<DraftTitle[]>([emptyDraftTitle()]);
  const [submitterRole, setSubmitterRole] = useState("");
  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot -- stays empty for a real person
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const campuses = useCampuses();

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

  // A native <select> listing every course, grouped by program with
  // <optgroup> -- on a phone this opens the OS's own large touch-friendly
  // picker instead of a small custom list fighting the on-screen keyboard
  // (what made finding a course here hard to use on mobile with an earlier
  // type-to-filter combobox), and unlike a Program-then-Course cascade,
  // every course is visible right away instead of being gated behind
  // picking a program first.
  //
  // With enough programs/courses, though, that single list is still a lot
  // to scroll through with nothing but touch -- so a plain text filter
  // narrows it first. This stays a completely separate step from opening
  // the select (typing happens in an ordinary text input, no floating
  // results panel layered over the keyboard), so it doesn't reintroduce
  // the same mobile problem the old combobox had.
  const allSubjectGroups = useMemo(() => {
    const map = new Map<string, SubjectSummaryRow[]>();
    for (const s of subjects) {
      if (!map.has(s.program)) map.set(s.program, []);
      map.get(s.program)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([program, subs]) => ({ program, subs: subs.sort((a, b) => a.sort_order - b.sort_order) }));
  }, [subjects]);

  const subjectGroups = useMemo(() => {
    const q = courseQuery.trim().toLowerCase();
    if (!q) return allSubjectGroups;
    return allSubjectGroups
      .map((g) => ({
        program: g.program,
        subs: g.subs.filter((s) =>
          s.course_code.toLowerCase().includes(q) ||
          s.course_title.toLowerCase().includes(q) ||
          g.program.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.subs.length > 0);
  }, [allSubjectGroups, courseQuery]);

  // A filter narrow enough to drop the currently-picked course out of the
  // visible list would otherwise silently clear the selection the moment
  // the <select> re-renders with that <option> gone -- keep it selectable
  // regardless of the filter text so refining the search never loses a
  // choice already made.
  const selectedSubject = useMemo(
    () => subjects.find((s) => String(s.subject_id) === subjectId),
    [subjects, subjectId],
  );
  const selectedSubjectVisible = subjectGroups.some((g) => g.subs.some((s) => String(s.subject_id) === subjectId));

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
    if (!campus || !subjectId || validTitles.length === 0 || !submitterRole) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/title-recommendations/public", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campus,
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
      setCampus(""); setCourseQuery(""); setSubjectId(""); setTitles([emptyDraftTitle()]);
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
                <span className="text-xs">Campus *</span>
                <select className="input w-full" value={campus} onChange={(e) => setCampus(e.target.value)}>
                  <option value="">Select your campus…</option>
                  {campuses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </label>

              <label className="label flex-col items-start gap-1">
                <span className="text-xs">Course *</span>
                <input
                  type="search"
                  className="input w-full"
                  placeholder="Search by course code or title to narrow the list below…"
                  value={courseQuery}
                  onChange={(e) => setCourseQuery(e.target.value)}
                />
                <select className="input w-full mt-1" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">{subjectGroups.length ? "Select a course…" : "No courses match your search"}</option>
                  {!selectedSubjectVisible && selectedSubject && (
                    <option value={String(selectedSubject.subject_id)}>
                      {selectedSubject.course_code} — {selectedSubject.course_title} (currently selected)
                    </option>
                  )}
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
              <button type="submit" className="btn text-sm" disabled={submitting || !campus || !subjectId || validTitles.length === 0 || !submitterRole}>
                {submitting ? "Submitting…" : validTitles.length > 1 ? `Submit ${validTitles.length} Suggestions` : "Submit Suggestion"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
