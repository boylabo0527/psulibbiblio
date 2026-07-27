"use client";
import { useEffect, useState } from "react";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";
import { apiFetch } from "@/lib/api-client";
import { JOURNAL_MIN_UNDERGRAD, JOURNAL_MIN_GRADUATE_ADDITIONAL } from "@/lib/compliance";

type JournalTitle = {
  id: number; format: ResourceTypeId; title: string; author: string;
  call_no: string; issn: string; year: string; copies: number; url?: string;
};
type Buckets = Record<ResourceTypeId, JournalTitle[]>;

const JOURNAL_TYPES = RESOURCE_TYPES.filter((t) => t.kind === "journal");

/** Read-only "journals for this program" panel -- a journal subscription
 *  applies to the whole program, not one course (see loadProgramBibliography
 *  in lib/bibliography.ts), so this fetches the same program-wide,
 *  deduplicated list Programs & Export shows, for the Dashboard and
 *  Procurement Analysis tabs where a librarian is checking a program's
 *  overall standing rather than editing individual titles. */
export default function ProgramJournalsPanel({
  programId, campus,
}: { programId: number | string | null; campus: string }) {
  const [journals, setJournals] = useState<Buckets | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!programId) { setJournals(null); return; }
    setLoading(true);
    setErr(null);
    const p = new URLSearchParams();
    if (campus) p.set("campus", campus);
    apiFetch(`/api/programs/${programId}/bibliography${p.toString() ? "?" + p.toString() : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setErr(j.error);
        else setJournals(j.journals ?? null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [programId, campus]);

  if (!programId) return null;

  const rows = journals ? JOURNAL_TYPES.flatMap((t) => journals[t.id] ?? []) : [];
  const total = rows.length;
  const meetsUndergrad = total >= JOURNAL_MIN_UNDERGRAD;
  const meetsGraduate = total >= JOURNAL_MIN_UNDERGRAD + JOURNAL_MIN_GRADUATE_ADDITIONAL;

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">Journals for this Program</h2>
      <p className="text-xs text-slate-500 mb-2">
        Program-wide (a journal subscription applies to every course, not one in particular) -- listed once here,
        matching Programs &amp; Export.
      </p>
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}
      {err && <p className="text-red-700 text-sm">{err}</p>}
      {!loading && !err && (
        <>
          <p className={"text-sm mb-2 " + (meetsUndergrad ? "text-emerald-700" : "text-amber-700")}>
            <strong>{total}</strong> journal title{total === 1 ? "" : "s"} —{" "}
            {meetsUndergrad ? "meets" : "below"} the CMO No. 15 s.2019 minimum of {JOURNAL_MIN_UNDERGRAD} for an
            undergraduate program{meetsUndergrad && (
              meetsGraduate
                ? ` (and the ${JOURNAL_MIN_UNDERGRAD + JOURNAL_MIN_GRADUATE_ADDITIONAL} needed if this is also a graduate program)`
                : `; a graduate program needs ${JOURNAL_MIN_GRADUATE_ADDITIONAL} more on top of that (${JOURNAL_MIN_UNDERGRAD + JOURNAL_MIN_GRADUATE_ADDITIONAL} total)`
            )}.
          </p>
          {total === 0 ? (
            <p className="text-slate-500 text-sm">No journals matched to this program yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-200 text-left">
                    <th className="py-1 pr-2">Type</th>
                    <th className="py-1 pr-2">Call No. / ISSN</th>
                    <th className="py-1 pr-2">Title</th>
                    <th className="py-1 pr-2">Author</th>
                    <th className="py-1 pr-2">Year</th>
                  </tr>
                </thead>
                <tbody>
                  {JOURNAL_TYPES.flatMap((t) => (journals?.[t.id] ?? []).map((j) => (
                    <tr key={j.id} className="border-b border-slate-100">
                      <td className="py-1 pr-2">{t.sectionLabel}</td>
                      <td className="py-1 pr-2">{j.call_no || j.issn}</td>
                      <td className="py-1 pr-2">
                        {j.title}
                        {j.url && (
                          <a href={j.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-psu" title={j.url}>🔗</a>
                        )}
                      </td>
                      <td className="py-1 pr-2">{j.author}</td>
                      <td className="py-1 pr-2">{j.year}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
