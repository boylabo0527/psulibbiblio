"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Program = { id: number; name: string };
type Campus = { id: number; name: string };
type Mapping = { program_id: number; campus_id: number; campus_name: string };
type Course = { id: number; course_code: string; course_title: string; description: string };

export default function CampusValidationTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newProgram, setNewProgram] = useState("");
  const [newCampus, setNewCampus] = useState("");
  const [addingProgram, setAddingProgram] = useState(false);
  const [addingCampus, setAddingCampus] = useState(false);

  // Program rename
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Program merge
  const [mergeTarget, setMergeTarget] = useState("");
  const [merging, setMerging] = useState(false);

  // Courses (subjects) under the selected program
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<number | null>(null);
  const [courseDraft, setCourseDraft] = useState<Course | null>(null);
  const [courseMergeTargets, setCourseMergeTargets] = useState<Record<number, string>>({});
  const [savingCourse, setSavingCourse] = useState(false);

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [progRes, campRes, mapRes] = await Promise.all([
        apiFetch("/api/programs").then((r) => r.json()),
        apiFetch("/api/campuses").then((r) => r.json()),
        apiFetch("/api/program-campuses").then((r) => r.json()),
      ]);
      if (progRes.error) throw new Error(progRes.error);
      if (campRes.error) throw new Error(campRes.error);
      if (mapRes.error) throw new Error(mapRes.error);
      setPrograms(progRes.programs ?? []);
      setCampuses(campRes.campuses ?? []);
      setMappings(mapRes.mappings ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadCourses(programId: number) {
    setCoursesLoading(true);
    try {
      const res = await apiFetch(`/api/programs/${programId}/bibliography`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { setCourses([]); return; }
      type Sec = { subjects: { subject: Course }[] };
      const list: Course[] = (j.bySection ?? []).flatMap((sec: Sec) =>
        sec.subjects.map((s) => s.subject),
      );
      setCourses(list);
    } catch {
      setCourses([]);
    } finally {
      setCoursesLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (selected === null) { setChecked(new Set()); setCourses([]); return; }
    const ids = mappings.filter((m) => m.program_id === selected).map((m) => m.campus_id);
    setChecked(new Set(ids));
    loadCourses(selected);
  }, [selected, mappings]);

  function toggle(campusId: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(campusId)) next.delete(campusId);
      else next.add(campusId);
      return next;
    });
  }

  async function save() {
    if (selected === null) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/program-campuses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: selected, campus_ids: Array.from(checked) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addProgram() {
    const name = newProgram.trim();
    if (!name) return;
    setAddingProgram(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setNewProgram("");
      await loadAll();
      if (j.program?.id) setSelected(j.program.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingProgram(false);
    }
  }

  async function addCampus() {
    const name = newCampus.trim();
    if (!name) return;
    setAddingCampus(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/campuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setNewCampus("");
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingCampus(false);
    }
  }

  const campusCount = (programId: number) => mappings.filter((m) => m.program_id === programId).length;

  async function deleteProgram(p: Program) {
    if (!confirm(`Delete program "${p.name}"? This only works if it has no subjects.`)) return;
    setErr(null);
    try {
      const res = await apiFetch(`/api/programs/${p.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (selected === p.id) setSelected(null);
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function renameProgram(p: Program) {
    const name = renameDraft.trim();
    if (!name || name === p.name) { setRenamingId(null); return; }
    setErr(null);
    try {
      const res = await apiFetch(`/api/programs/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setRenamingId(null);
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function mergeProgram() {
    if (selected === null || !mergeTarget) return;
    const targetId = Number(mergeTarget);
    const sourceName = programs.find((p) => p.id === selected)?.name ?? "";
    const targetName = programs.find((p) => p.id === targetId)?.name ?? "";
    if (!confirm(`Merge "${sourceName}" into "${targetName}"? All its subjects move to "${targetName}" and "${sourceName}" is deleted.`)) return;
    setMerging(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/programs/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: selected, target_id: targetId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMergeTarget("");
      setSelected(targetId);
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  }

  async function saveCourse(c: Course) {
    if (!courseDraft) return;
    setSavingCourse(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/subjects/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_code: courseDraft.course_code,
          course_title: courseDraft.course_title,
          description: courseDraft.description,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setEditingCourseId(null);
      if (selected !== null) await loadCourses(selected);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCourse(false);
    }
  }

  async function mergeCourse(c: Course) {
    const targetId = Number(courseMergeTargets[c.id]);
    if (!targetId) return;
    const targetName = courses.find((x) => x.id === targetId)?.course_title ?? "";
    if (!confirm(`Merge "${c.course_title}" into "${targetName}"? Its titles move over and this course is deleted.`)) return;
    setErr(null);
    try {
      const res = await apiFetch("/api/subjects/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: c.id, target_id: targetId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (selected !== null) await loadCourses(selected);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Campus Validation</h2>
        <p className="text-sm text-slate-600 mb-4">
          Confirm which campuses offer each program. Programs with no campuses set here are
          treated as offered everywhere (they won&apos;t be hidden from campus filters elsewhere
          in the app) — assign campuses here once you&apos;ve verified them.
        </p>

        <div className="flex flex-wrap gap-6 mb-4">
          <div className="flex items-end gap-2">
            <label className="label">
              Add program
              <input
                className="input ml-1 w-64"
                placeholder="e.g. BS Fisheries"
                value={newProgram}
                onChange={(e) => setNewProgram(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addProgram(); }}
              />
            </label>
            <button className="btn text-xs" disabled={addingProgram || !newProgram.trim()} onClick={addProgram}>
              {addingProgram ? "Adding…" : "Add"}
            </button>
          </div>
          <div className="flex items-end gap-2">
            <label className="label">
              Add campus
              <input
                className="input ml-1 w-64"
                placeholder="e.g. PSU-ABORLAN"
                value={newCampus}
                onChange={(e) => setNewCampus(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCampus(); }}
              />
            </label>
            <button className="btn text-xs" disabled={addingCampus || !newCampus.trim()} onClick={addCampus}>
              {addingCampus ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
      </div>

      {!loading && (
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Programs</h3>
              <ul className="border border-slate-200 rounded divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
                {programs.length === 0 && (
                  <li className="p-2 text-xs text-slate-400">No programs yet.</li>
                )}
                {programs.map((p) => (
                  <li key={p.id} className="flex items-center">
                    {renamingId === p.id ? (
                      <div className="flex-1 flex items-center gap-1 px-2 py-1">
                        <input
                          className="input text-sm flex-1"
                          value={renameDraft}
                          autoFocus
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") renameProgram(p); if (e.key === "Escape") setRenamingId(null); }}
                        />
                        <button className="text-xs text-psu" onClick={() => renameProgram(p)}>save</button>
                        <button className="text-xs text-slate-400" onClick={() => setRenamingId(null)}>cancel</button>
                      </div>
                    ) : (
                      <>
                        <button
                          className={
                            "flex-1 text-left px-2 py-1.5 text-sm hover:bg-slate-50 " +
                            (selected === p.id ? "bg-psu-light text-psu font-medium" : "")
                          }
                          onClick={() => setSelected(p.id)}
                        >
                          {p.name}
                          <span className="block text-xs text-slate-400">
                            {campusCount(p.id) === 0 ? "unmapped (shown everywhere)" : `${campusCount(p.id)} campus(es)`}
                          </span>
                        </button>
                        <button
                          className="px-1.5 text-xs text-slate-500 hover:text-slate-700"
                          title="Rename program"
                          onClick={() => { setRenamingId(p.id); setRenameDraft(p.name); }}
                        >
                          rename
                        </button>
                        <button
                          className="px-1.5 text-xs text-red-500 hover:text-red-700"
                          title="Delete program (only if it has no subjects)"
                          onClick={() => deleteProgram(p)}
                        >
                          delete
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                {selected ? `Campuses offering: ${programs.find((p) => p.id === selected)?.name ?? ""}` : "Select a program"}
              </h3>
              {selected && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                    {campuses.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked.has(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                  <button className="btn text-xs" disabled={saving} onClick={save}>
                    {saving ? "Saving…" : "Save campus offerings"}
                  </button>

                  <div className="mt-5 pt-4 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-600 mb-2">
                      Combine this program into a duplicate — moves all its subjects over and deletes this one.
                    </p>
                    <div className="flex items-center gap-2">
                      <select className="input text-xs" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                        <option value="">— select target program —</option>
                        {programs.filter((p) => p.id !== selected).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button className="btn-outline text-xs" disabled={merging || !mergeTarget} onClick={mergeProgram}>
                        {merging ? "Merging…" : "Merge into…"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-600 mb-2">Courses in this program</p>
                    {coursesLoading && <p className="text-xs text-slate-400">Loading courses…</p>}
                    {!coursesLoading && courses.length === 0 && (
                      <p className="text-xs text-slate-400">No courses yet.</p>
                    )}
                    {!coursesLoading && courses.length > 0 && (
                      <ul className="border border-slate-200 rounded divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
                        {courses.map((c) => (
                          <li key={c.id} className="p-2">
                            {editingCourseId === c.id && courseDraft ? (
                              <div className="space-y-1">
                                <input
                                  className="input text-xs w-full"
                                  placeholder="Course code"
                                  value={courseDraft.course_code}
                                  onChange={(e) => setCourseDraft({ ...courseDraft, course_code: e.target.value })}
                                />
                                <input
                                  className="input text-xs w-full"
                                  placeholder="Course title"
                                  value={courseDraft.course_title}
                                  onChange={(e) => setCourseDraft({ ...courseDraft, course_title: e.target.value })}
                                />
                                <textarea
                                  className="input text-xs w-full"
                                  rows={2}
                                  placeholder="Description"
                                  value={courseDraft.description}
                                  onChange={(e) => setCourseDraft({ ...courseDraft, description: e.target.value })}
                                />
                                <div className="flex gap-2">
                                  <button className="text-xs text-psu" disabled={savingCourse} onClick={() => saveCourse(c)}>save</button>
                                  <button className="text-xs text-slate-400" onClick={() => setEditingCourseId(null)}>cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm">
                                  <span className="font-medium">{c.course_code}</span>{" "}
                                  <span>{c.course_title}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    className="text-xs text-slate-500 hover:text-slate-700"
                                    onClick={() => { setEditingCourseId(c.id); setCourseDraft(c); }}
                                  >
                                    edit
                                  </button>
                                  <select
                                    className="input text-xs"
                                    value={courseMergeTargets[c.id] ?? ""}
                                    onChange={(e) => setCourseMergeTargets((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                  >
                                    <option value="">merge into…</option>
                                    {courses.filter((x) => x.id !== c.id).map((x) => (
                                      <option key={x.id} value={x.id}>{x.course_code} {x.course_title}</option>
                                    ))}
                                  </select>
                                  <button
                                    className="text-xs text-psu"
                                    disabled={!courseMergeTargets[c.id]}
                                    onClick={() => mergeCourse(c)}
                                  >
                                    go
                                  </button>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
