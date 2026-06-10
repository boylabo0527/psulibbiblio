"use client";
import { useState } from "react";

export default function MatchTab() {
  const [topK, setTopK] = useState(10);
  const [minScore, setMinScore] = useState(0.05);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function run() {
    setBusy(true);
    setResult("Running...");
    try {
      const url = `/api/match/run?top_k=${topK}&min_score=${minScore}`;
      const r = await fetch(url, { method: "POST" });
      setResult(JSON.stringify(await r.json(), null, 2));
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-2">Run AI Matching</h2>
      <p className="text-sm text-slate-600 mb-3">
        Local TF-IDF + cosine similarity. Replaces prior auto matches; preserves manually-overridden rows.
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="label">
          Top K per course
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            className="input ml-1 w-20"
          />
        </label>
        <label className="label">
          Min score
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="input ml-1 w-20"
          />
        </label>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "Matching..." : "Run matching"}
        </button>
      </div>
      {result && (
        <pre className="mt-3 bg-slate-100 rounded p-2 text-xs overflow-auto max-h-64">{result}</pre>
      )}
    </div>
  );
}
