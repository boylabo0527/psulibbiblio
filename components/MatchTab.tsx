"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { consumeNdjson } from "@/lib/streaming";
import type { MatchProgressEvent } from "@/app/api/match/run/route";

type Program = { id: number; name: string };

const PHASE_LABEL: Record<Exclude<MatchProgressEvent["phase"], "fetching">, string> = {
  embedding_model: "Loading embedding model (first run after a deploy takes longer)…",
  embedding: "Embedding subjects…",
  matching: "Matching + saving subjects…",
  done: "Done",
  error: "Error",
};

function phaseLabel(progress: MatchProgressEvent): string {
  if (progress.phase === "fetching") return `Loading ${progress.label}…`;
  return PHASE_LABEL[progress.phase];
}

export default function MatchTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<string>("");
  const [topK, setTopK] = useState(8);
  const [balanceFormats, setBalanceFormats] = useState(false);
  const [topKPrinted, setTopKPrinted] = useState(4);
  const [topKDigital, setTopKDigital] = useState(4);
  const [minScore, setMinScore] = useState(0.06);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MatchProgressEvent | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    apiFetch("/api/programs").then((r) => r.json()).then((d) => setPrograms(d.programs ?? [])).catch(() => {});
  }, []);

  useEffect(() => () => { if (tickerRef.current) clearInterval(tickerRef.current); }, []);

  async function run() {
    setBusy(true);
    setError(null);
    setProgress({ phase: "fetching", done: 0, total: 0, label: "subjects" });
    const startedAt = Date.now();
    setElapsedMs(0);
    tickerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    try {
      const params = new URLSearchParams({ top_k: String(topK), min_score: String(minScore) });
      if (programId) params.set("program_id", programId);
      if (balanceFormats) {
        params.set("top_k_printed", String(topKPrinted));
        params.set("top_k_digital", String(topKDigital));
      }
      const res = await apiFetch(`/api/match/run?${params}`, { method: "POST" });
      await consumeNdjson<MatchProgressEvent>(res, (ev) => {
        setProgress(ev);
        if (ev.phase === "error") setError(ev.error);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (tickerRef.current) clearInterval(tickerRef.current);
      setBusy(false);
    }
  }

  const pct = progress
    && (progress.phase === "fetching" || progress.phase === "embedding" || progress.phase === "matching")
    && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : null;

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-2">Run Matching</h2>
      <p className="text-sm text-slate-600 mb-3">
        Hybrid keyword (full-text search) + semantic (sentence embedding) matching on the subject description.
        Auto-assigns the top K titles across all formats (eBooks, printed books, journals) per subject. Manual additions and pins are preserved.
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
        {!balanceFormats && (
          <label className="label">
            Top K
            <input type="number" min={1} max={50} className="input ml-1 w-20"
              value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
          </label>
        )}
        <label className="label">
          Min score
          <input type="number" min={0} max={1} step={0.01} className="input ml-1 w-20"
            value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
        </label>
        <button className="btn" onClick={run} disabled={busy}>{busy ? "Matching…" : "Run matching"}</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={balanceFormats} onChange={(e) => setBalanceFormats(e.target.checked)} />
          Guarantee a mix of printed and digital titles
        </label>
        {balanceFormats && (
          <>
            <label className="label">
              Top printed
              <input type="number" min={0} max={50} className="input ml-1 w-20"
                value={topKPrinted} onChange={(e) => setTopKPrinted(Number(e.target.value))} />
            </label>
            <label className="label">
              Top digital
              <input type="number" min={0} max={50} className="input ml-1 w-20"
                value={topKDigital} onChange={(e) => setTopKDigital(Number(e.target.value))} />
            </label>
          </>
        )}
      </div>

      {progress && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-slate-600 mb-1">
            <span>
              {phaseLabel(progress)}
              {pct !== null && (progress.phase === "fetching" || progress.phase === "embedding" || progress.phase === "matching")
                ? ` (${progress.done.toLocaleString()} / ${progress.total.toLocaleString()})`
                : ""}
            </span>
            <span>{(elapsedMs / 1000).toFixed(1)}s</span>
          </div>
          <div className="h-1.5 w-full bg-slate-200 rounded overflow-hidden">
            <div
              className={
                "h-full transition-all " +
                (progress.phase === "error" ? "bg-red-500" : progress.phase === "done" ? "bg-emerald-500" : "bg-psu")
              }
              style={{ width: progress.phase === "done" || progress.phase === "error" ? "100%" : pct !== null ? `${Math.max(8, pct)}%` : "30%" }}
            />
          </div>

          {progress.phase === "done" && (
            <div className="mt-3 bg-slate-100 rounded p-2 text-xs">
              <p><strong>{progress.matches.toLocaleString()}</strong> matches assigned across <strong>{progress.subjects.toLocaleString()}</strong> subjects and <strong>{progress.titles.toLocaleString()}</strong> titles.</p>
              {progress.locked_skipped > 0 && (
                <p className="text-slate-500 mt-1">{progress.locked_skipped.toLocaleString()} locked subject{progress.locked_skipped === 1 ? "" : "s"} skipped — left untouched.</p>
              )}
              {!progress.semantic_used && (
                <p className="text-amber-700 mt-1">Semantic matching wasn&apos;t available this run — fell back to keyword matching (BM25) only. Safe to ignore unless this persists.</p>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-red-700 text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
