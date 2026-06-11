"use client";
import { useCallback, useEffect, useState } from "react";

type ProgramSummary = { id: number; name: string; subjects: number };
type ProgramGroup = { normalized: string; programs: ProgramSummary[] };

export default function CleanupTab() {
  return <ProgramsCleanup />;
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
      const res = await fetch("/api/programs/duplicates");
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
    try {
      const res = await fetch("/api/programs/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_id: keepId, drop_ids: dropIds }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
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
    try {
      const res = await fetch(`/api/programs/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
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
