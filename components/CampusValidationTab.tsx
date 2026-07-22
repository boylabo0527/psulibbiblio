"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Program = { id: number; name: string };
type Campus = { id: number; name: string };
type Mapping = { program_id: number; campus_id: number; campus_name: string };

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

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (selected === null) { setChecked(new Set()); return; }
    const ids = mappings.filter((m) => m.program_id === selected).map((m) => m.campus_id);
    setChecked(new Set(ids));
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
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Programs</h3>
              <ul className="border border-slate-200 rounded divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
                {programs.length === 0 && (
                  <li className="p-2 text-xs text-slate-400">No programs yet.</li>
                )}
                {programs.map((p) => (
                  <li key={p.id}>
                    <button
                      className={
                        "w-full text-left px-2 py-1.5 text-sm hover:bg-slate-50 " +
                        (selected === p.id ? "bg-psu-light text-psu font-medium" : "")
                      }
                      onClick={() => setSelected(p.id)}
                    >
                      {p.name}
                      <span className="block text-xs text-slate-400">
                        {campusCount(p.id) === 0 ? "unmapped (shown everywhere)" : `${campusCount(p.id)} campus(es)`}
                      </span>
                    </button>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
