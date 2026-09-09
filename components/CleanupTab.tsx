"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { SubjectSearchRow } from "@/app/api/subjects/search/route";
import type { DuplicateSubjectGroup } from "@/app/api/subjects/duplicates/route";

type ProgramSummary = { id: number; name: string; subjects: number };
type ProgramGroup = { normalized: string; programs: ProgramSummary[] };

export default function CleanupTab() {
  return (
    <>
      <SubjectFinder />
      <DuplicateCoursesCleanup />
      <ProgramsCleanup />
    </>
  );
}

/** Diagnostic for "Match said N titles were assigned but they don't show up
 *  anywhere" -- the usual cause is two subjects with the same or similar
 *  name (an accidental double upload, or the same course listed under two
 *  programs), where a run against one doesn't show up under the other.
 *  Searches by course code/title and shows each match's program, id, and a
 *  live breakdown of what's actually in `assignments` for it right now, so
 *  that can be confirmed (or ruled out) without needing database access. */
function SubjectFinder() {
  const [q, setQ] = useState("");
  const [campus, setCampus] = useState("");
  const [rows, setRows] = useState<SubjectSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function search() {
    if (!q.trim()) { setRows([]); setSearched(false); return; }
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams({ q: q.trim() });
      if (campus.trim()) p.set("campus", campus.trim());
      const res = await apiFetch(`/api/subjects/search?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRows(data.subjects ?? []);
      setSearched(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">Find a Subject</h2>
      <p className="text-xs text-slate-600 mb-3">
        Search by course code or title. Shows every matching subject -- across every program -- with its own live
        count of what&apos;s actually assigned to it (auto-matched vs. locked, by format). If a course name shows up
        more than once here, that&apos;s almost always why a Match run &quot;succeeded&quot; but the results don&apos;t
        appear where you expected: the run and the page you were looking at are two different subjects.
        The last column runs the exact same code Programs &amp; Export uses and shows what it actually returns for
        that subject -- type the campus exactly as it appears in the Campus dropdown there to test that too.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="input text-sm flex-1 max-w-md"
          placeholder="e.g. Arnis, PATH Fit-DEFTAC 2…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
        />
        <input
          className="input text-sm max-w-[220px]"
          placeholder="Campus (optional, e.g. Main Campus)"
          value={campus}
          onChange={(e) => setCampus(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
        />
        <button className="btn text-xs" disabled={loading} onClick={search}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {searched && !loading && rows.length === 0 && !err && (
        <p className="text-sm text-slate-500">No subjects matched.</p>
      )}
      {rows.length > 1 && (
        <p className="text-xs text-amber-700 mb-2">
          {rows.length} subjects matched &quot;{q}&quot; -- if these are meant to be the same course, that&apos;s the
          likely cause.
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200 text-left">
                <th className="py-1 pr-2">Subject ID</th>
                <th className="py-1 pr-2">Program</th>
                <th className="py-1 pr-2">Code</th>
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 pr-2">Assignments right now</th>
                <th className="py-1 pr-2">Programs &amp; Export would show</th>
                <th className="py-1 pr-2">Whole-program fetch (real page)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const rawTotal = s.assignments.reduce((a, x) => a + x.count, 0);
                const mismatch = s.visibleViaBibliography.noCampusFilter >= 0 && s.visibleViaBibliography.noCampusFilter !== rawTotal;
                return (
                  <tr key={s.subject_id} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-2 text-slate-400">{s.subject_id}</td>
                    <td className="py-1.5 pr-2">{s.program}</td>
                    <td className="py-1.5 pr-2">{s.course_code}</td>
                    <td className="py-1.5 pr-2">{s.course_title}</td>
                    <td className="py-1.5 pr-2">
                      {s.assignments.length === 0 ? (
                        <span className="text-slate-400">none</span>
                      ) : (
                        <ul>
                          {s.assignments.map((a, i) => (
                            <li key={i}>
                              {a.format}{a.manual ? " (locked)" : ""}: <strong>{a.count}</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {s.visibleViaBibliography.noCampusFilter < 0 ? (
                        <span className="text-slate-400">(only checked for the first 10 matches)</span>
                      ) : (
                        <>
                          <div className={mismatch ? "text-red-700 font-medium" : ""}>
                            No campus filter: <strong>{s.visibleViaBibliography.noCampusFilter}</strong> of {rawTotal} raw
                          </div>
                          {s.visibleViaBibliography.withCampusFilter !== null && (
                            <div>With &quot;{campus}&quot;: <strong>{s.visibleViaBibliography.withCampusFilter}</strong></div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {s.wholeProgram === null ? (
                        <span className="text-slate-400">(only checked for the first 3 matches)</span>
                      ) : (
                        <div className={s.wholeProgram.thisSubjectCount !== s.visibleViaBibliography.noCampusFilter ? "text-red-700 font-medium" : ""}>
                          {s.wholeProgram.subjectsInProgram.toLocaleString()} subjects in program, this one:{" "}
                          <strong>{s.wholeProgram.thisSubjectCount}</strong>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Scans for two courses in the same program that could confuse Match or
 *  the Validate Matches CSV workflow: a shared course code (a real bug --
 *  re-uploading a reviewed CSV keys off course_code, so two subjects
 *  sharing one silently collapse to whichever the lookup saw last) and,
 *  separately, a shared title under different codes (milder, but usually
 *  a data-entry accident worth catching too). Reuses /api/subjects/merge
 *  (one course at a time) to fold the extras into whichever one the admin
 *  picks to keep. */
function DuplicateCoursesCleanup() {
  const [codeGroups, setCodeGroups] = useState<DuplicateSubjectGroup[]>([]);
  const [titleGroups, setTitleGroups] = useState<DuplicateSubjectGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/subjects/duplicates");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCodeGroups(data.codeGroups ?? []);
      setTitleGroups(data.titleGroups ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function merge(keepId: number, dropIds: number[]) {
    if (!confirm(
      `Merge ${dropIds.length} course(s) into the chosen one?\n` +
      `All title matches (locked and auto-matched) move over, then the duplicates are deleted.`,
    )) return;
    setBusy(true);
    setErr(null);
    try {
      let totalMoved = 0;
      for (const dropId of dropIds) {
        const res = await apiFetch("/api/subjects/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_id: dropId, target_id: keepId }),
        });
        const text = await res.text();
        let data: { error?: string; moved?: number } = {};
        try { data = JSON.parse(text); } catch { /* non-JSON response -- keep raw text */ }
        if (!res.ok || data.error) throw new Error(data.error || text || `HTTP ${res.status}`);
        totalMoved += data.moved ?? 0;
      }
      await load();
      alert(`Merged. Moved ${totalMoved} assignment(s).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      alert(`Merge failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  const total = codeGroups.length + titleGroups.length;

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-2">Duplicate Courses</h2>
      <p className="text-xs text-slate-600 mb-3">
        Courses in the same program that share a code, or share a title under different codes -- either can
        confuse Match or silently drop one of them from a re-uploaded Validate Matches CSV, since that review
        keys off the course code. Pick which one to keep and merge the others into it; the course with the
        most assignments is preselected.
      </p>
      <div className="flex gap-2 mb-2">
        <button className="btn-outline text-xs" onClick={load} disabled={loading || busy}>
          {loading ? "Scanning…" : "Rescan"}
        </button>
      </div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {!loading && total === 0 && (
        <p className="text-sm text-slate-500">No duplicate courses found.</p>
      )}
      {codeGroups.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-red-700 mt-2 mb-1">Same course code ({codeGroups.length})</h3>
          <ul className="space-y-3 mb-3">
            {codeGroups.map((g) => (
              <DuplicateSubjectGroupRow key={`code-${g.program_id}-${g.key}`} group={g} onMerge={merge} busy={busy} />
            ))}
          </ul>
        </>
      )}
      {titleGroups.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-amber-700 mt-2 mb-1">Same title, different code ({titleGroups.length})</h3>
          <ul className="space-y-3">
            {titleGroups.map((g) => (
              <DuplicateSubjectGroupRow key={`title-${g.program_id}-${g.key}`} group={g} onMerge={merge} busy={busy} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DuplicateSubjectGroupRow({
  group, onMerge, busy,
}: {
  group: DuplicateSubjectGroup;
  onMerge: (keepId: number, dropIds: number[]) => void;
  busy: boolean;
}) {
  const [keep, setKeep] = useState<number>(group.subjects[0]?.id ?? 0);

  return (
    <li className="border border-slate-200 rounded p-2 text-sm">
      <div className="font-medium mb-1">{group.program} — {group.subjects.length} entries</div>
      <table className="w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="text-left p-1 w-10">Keep</th>
            <th className="text-left p-1">Code</th>
            <th className="text-left p-1">Title</th>
            <th className="text-left p-1 w-28">Assignments</th>
            <th className="text-left p-1 w-16">ID</th>
          </tr>
        </thead>
        <tbody>
          {group.subjects.map((s) => (
            <tr key={s.id} className="border-t border-slate-100">
              <td className="p-1">
                <input
                  type="radio"
                  name={`keep-${group.program_id}-${group.key}`}
                  checked={keep === s.id}
                  onChange={() => setKeep(s.id)}
                />
              </td>
              <td className="p-1">{s.course_code || <span className="text-slate-400">(none)</span>}</td>
              <td className="p-1">{s.course_title}</td>
              <td className="p-1">{s.total_assignments} total{s.locked_assignments > 0 && `, ${s.locked_assignments} locked`}</td>
              <td className="p-1 text-slate-400">{s.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2">
        <button
          className="btn text-xs"
          disabled={busy || !keep}
          onClick={() => onMerge(keep, group.subjects.filter((s) => s.id !== keep).map((s) => s.id))}
        >
          Merge other {group.subjects.length - 1} into keeper
        </button>
      </div>
    </li>
  );
}

function ProgramsCleanup() {
  const [groups, setGroups] = useState<ProgramGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/programs/duplicates");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setGroups(data.groups ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function merge(keepId: number, dropIds: number[]) {
    if (!confirm(
      `Merge ${dropIds.length} program(s) into the chosen one?\n` +
      `All subjects in the dropped programs will be moved over, then the duplicates deleted.`,
    )) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/programs/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_id: keepId, drop_ids: dropIds }),
      });
      const text = await res.text();
      let data: { error?: string; moved_subjects?: number; deleted_programs?: number } = {};
      try { data = JSON.parse(text); } catch { /* non-JSON response — keep raw text */ }
      if (!res.ok || data.error) {
        throw new Error(data.error || text || `HTTP ${res.status}`);
      }
      await load();
      alert(
        `Merged. Moved ${data.moved_subjects ?? 0} subject(s); ` +
        `deleted ${data.deleted_programs ?? 0} program(s).`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      alert(`Merge failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function del(id: number, name: string, subjects: number) {
    const msg = subjects > 0
      ? `Delete "${name}"? This also deletes ${subjects} subject(s) and any title assignments for those subjects.`
      : `Delete "${name}"?`;
    if (!confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/programs/${id}`, { method: "DELETE" });
      const text = await res.text();
      let data: { error?: string } = {};
      try { data = JSON.parse(text); } catch { /* non-JSON response — keep raw text */ }
      if (!res.ok || data.error) {
        throw new Error(data.error || text || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      alert(`Delete failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-2">Duplicate Programs</h2>
      <p className="text-xs text-slate-600 mb-3">
        Programs whose names match after lowercasing, collapsing whitespace, and stripping punctuation.
        Pick which one to keep — its subjects stay put — and merge the others into it. The program with the
        most subjects is preselected.
      </p>
      <div className="flex gap-2 mb-2">
        <button className="btn-outline text-xs" onClick={load} disabled={loading || busy}>
          {loading ? "Scanning…" : "Rescan"}
        </button>
      </div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {!loading && groups.length === 0 && (
        <p className="text-sm text-slate-500">No duplicate programs found.</p>
      )}
      <ul className="space-y-3">
        {groups.map((g) => (
          <ProgramGroupRow key={g.normalized} group={g} onMerge={merge} onDelete={del} busy={busy} />
        ))}
      </ul>
    </div>
  );
}

function ProgramGroupRow({
  group, onMerge, onDelete, busy,
}: {
  group: ProgramGroup;
  onMerge: (keepId: number, dropIds: number[]) => void;
  onDelete: (id: number, name: string, subjects: number) => void;
  busy: boolean;
}) {
  const [keep, setKeep] = useState<number>(group.programs[0]?.id ?? 0);

  return (
    <li className="border border-slate-200 rounded p-2 text-sm">
      <div className="font-medium mb-1">"{group.normalized}" — {group.programs.length} entries</div>
      <table className="w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="text-left p-1 w-10">Keep</th>
            <th className="text-left p-1">Name</th>
            <th className="text-left p-1 w-20">Subjects</th>
            <th className="text-left p-1 w-16">ID</th>
            <th className="p-1 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {group.programs.map((p) => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="p-1">
                <input
                  type="radio"
                  name={`keep-${group.normalized}`}
                  checked={keep === p.id}
                  onChange={() => setKeep(p.id)}
                />
              </td>
              <td className="p-1">{p.name}</td>
              <td className="p-1">{p.subjects}</td>
              <td className="p-1 text-slate-400">{p.id}</td>
              <td className="p-1 text-right">
                <button
                  className="text-red-600 text-xs"
                  disabled={busy}
                  onClick={() => onDelete(p.id, p.name, p.subjects)}
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2">
        <button
          className="btn text-xs"
          disabled={busy || !keep}
          onClick={() => onMerge(keep, group.programs.filter((p) => p.id !== keep).map((p) => p.id))}
        >
          Merge other {group.programs.length - 1} into keeper
        </button>
      </div>
    </li>
  );
}
