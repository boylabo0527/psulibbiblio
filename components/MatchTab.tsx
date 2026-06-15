"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Program = { id: number; name: string };

export default function MatchTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<string>("");
  const [topK, setTopK] = useState(8);
  const [minScore, setMinScore] = useState(0.06);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    apiFetch("/api/programs").then((r) => r.json()).then((d) => setPrograms(d.programs ?? [])).catch(() => {});
  }, []);

  async function run() {
    setBusy(true);
    setResult("Running...");
    try {
      const params = new URLSearchParams({ top_k: String(topK), min_score: String(minScore) });
      if (programId) params.set("program_id", programId);
      const r = await apiFetch(`/api/match/run?${params}`, { method: "POST" });
      setResult(JSON.stringify(await r.json(), null, 2));
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-2">Run Matching</h2>
      <p className="text-sm text-slate-600 mb-3">
        TF-IDF + cosine on the subject description. Auto-assigns the top K books (eBooks + Printed) per subject.
        Manual additions and pins are preserved.
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="label">
          Program
          <select className="input ml-1" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="label">
          Top K
          <input type="number" min={1} max={50} className="input ml-1 w-20"
            value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
        </label>
        <label className="label">
          Min score
          <input type="number" min={0} max={1} step={0.01} className="input ml-1 w-20"
            value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
        </label>
        <button className="btn" onClick={run} disabled={busy}>{busy ? "Matching..." : "Run matching"}</button>
      </div>
      {result && <pre className="mt-3 bg-slate-100 rounded p-2 text-xs overflow-auto max-h-64">{result}</pre>}
    </div>
  );
}
