"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { consumeNdjson } from "@/lib/streaming";
import type { MatchProgressEvent } from "@/app/api/match/run/route";

type Program = { id: number; name: string };

// Persisted so an interrupted run (laptop sleeps, tab closes, network
// drops mid-chunk) can be resumed from its last committed batch instead of
// restarting from subject 1 -- localStorage survives a sleep/wake cycle
// even though the in-flight network connection driving the run doesn't.
const CHECKPOINT_KEY = "psulib-match-checkpoint-v1";

type MatchCheckpoint = {
  offset: number;
  total: number;
  matchesSoFar: number;
  failedSoFar: { course_code: string; error: string }[];
  params: {
    topK: number; minScore: number; programId: string;
    balanceFormats: boolean; topKPrinted: number; topKDigital: number;
  };
  savedAt: number;
};

function loadCheckpoint(): MatchCheckpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHECKPOINT_KEY);
    return raw ? (JSON.parse(raw) as MatchCheckpoint) : null;
  } catch {
    return null;
  }
}

function saveCheckpoint(cp: MatchCheckpoint) {
  try { window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp)); } catch { /* ignore */ }
}

function clearCheckpoint() {
  try { window.localStorage.removeItem(CHECKPOINT_KEY); } catch { /* ignore */ }
}

const PHASE_LABEL: Record<Exclude<MatchProgressEvent["phase"], "fetching">, string> = {
  embedding_model: "Loading embedding model (first run after a deploy takes longer)…",
  embedding: "Embedding subjects…",
  matching: "Matching + saving subjects…",
  paused: "Continuing (large run split into multiple requests)…",
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
  const [resumable, setResumable] = useState<MatchCheckpoint | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    apiFetch("/api/programs").then((r) => r.json()).then((d) => setPrograms(d.programs ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    setResumable(loadCheckpoint());
  }, []);

  useEffect(() => () => { if (tickerRef.current) clearInterval(tickerRef.current); }, []);

  async function run(resume?: MatchCheckpoint) {
    setBusy(true);
    setError(null);
    setResumable(null);
    setProgress({ phase: "fetching", done: 0, total: 0, label: "subjects" });
    const startedAt = Date.now();
    setElapsedMs(0);
    tickerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    // A resumed run keeps using the ORIGINAL run's settings throughout,
    // even if the form has since been changed -- mixing settings across
    // chunks of the same logical run would produce an incoherent result.
    const p = resume?.params ?? { topK, minScore, programId, balanceFormats, topKPrinted, topKDigital };
    try {
      // A large catalog can take longer to match than a single serverless
      // request is allowed to run. Rather than fail once the platform's
      // time limit hits, the server stops itself early and reports how far
      // it got ("paused") -- this loop just keeps asking it to continue
      // from there until the whole run is actually done. Progress is also
      // checkpointed to localStorage after every batch, so if the browser
      // itself gets interrupted (e.g. the machine sleeps) partway through,
      // the next visit can resume from the last committed batch instead of
      // restarting from subject 1.
      let offset = resume?.offset ?? 0;
      let matchesSoFar = resume?.matchesSoFar ?? 0;
      let failedSoFar: { course_code: string; error: string }[] = resume?.failedSoFar ?? [];
      for (;;) {
        const params = new URLSearchParams({ top_k: String(p.topK), min_score: String(p.minScore) });
        if (p.programId) params.set("program_id", p.programId);
        if (p.balanceFormats) {
          params.set("top_k_printed", String(p.topKPrinted));
          params.set("top_k_digital", String(p.topKDigital));
        }
        if (offset > 0) {
          params.set("offset", String(offset));
          params.set("matches_so_far", String(matchesSoFar));
          params.set("failed_so_far", JSON.stringify(failedSoFar));
        }
        const res = await apiFetch(`/api/match/run?${params}`, { method: "POST" });
        let paused: Extract<MatchProgressEvent, { phase: "paused" }> | null = null;
        await consumeNdjson<MatchProgressEvent>(res, (ev) => {
          setProgress(ev);
          if (ev.phase === "error") setError(ev.error);
          if (ev.phase === "paused") paused = ev;
          if (ev.phase === "matching" || ev.phase === "paused") {
            saveCheckpoint({
              offset: ev.done, total: ev.total,
              matchesSoFar: ev.matches_so_far, failedSoFar: ev.failed_so_far,
              params: p, savedAt: Date.now(),
            });
          }
        });
        if (!paused) break;
        const pausedEv: Extract<MatchProgressEvent, { phase: "paused" }> = paused;
        offset = pausedEv.next_offset;
        matchesSoFar = pausedEv.matches_so_far;
        failedSoFar = pausedEv.failed_so_far;
      }
      clearCheckpoint();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResumable(loadCheckpoint());
    } finally {
      if (tickerRef.current) clearInterval(tickerRef.current);
      setBusy(false);
    }
  }

  function discardCheckpoint() {
    clearCheckpoint();
    setResumable(null);
  }

  const pct = progress
    && (progress.phase === "fetching" || progress.phase === "embedding" || progress.phase === "matching" || progress.phase === "paused")
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
        <button className="btn" onClick={() => run()} disabled={busy}>{busy ? "Matching…" : "Run matching"}</button>
      </div>

      {resumable && !busy && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded p-2.5 text-xs flex items-center justify-between gap-3 flex-wrap">
          <span>
            A previous matching run was interrupted at <strong>{resumable.offset.toLocaleString()} / {resumable.total.toLocaleString()}</strong> subjects
            (e.g. the browser lost its connection, or the computer went to sleep). Nothing already matched was lost.
          </span>
          <div className="flex gap-2 shrink-0">
            <button className="btn text-xs" onClick={() => run(resumable)}>Resume</button>
            <button className="btn-outline text-xs" onClick={discardCheckpoint}>Discard</button>
          </div>
        </div>
      )}

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
              {pct !== null && (progress.phase === "fetching" || progress.phase === "embedding" || progress.phase === "matching" || progress.phase === "paused")
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
              {!progress.semantic_used && (
                <p className="text-amber-700 mt-1">Semantic matching wasn&apos;t available this run — fell back to keyword matching (BM25) only. Safe to ignore unless this persists.</p>
              )}
              {progress.failed_subjects.length > 0 && (
                <div className="text-red-700 mt-1">
                  <p>{progress.failed_subjects.length} subject{progress.failed_subjects.length === 1 ? "" : "s"} couldn&apos;t be matched this run (query timed out even after a retry) and were left with no auto-matched titles:</p>
                  <ul className="list-disc ml-4 mt-1">
                    {progress.failed_subjects.map((f, i) => (
                      <li key={i}>{f.course_code} — {f.error}</li>
                    ))}
                  </ul>
                  <p className="mt-1">This usually means the database was under heavy load during the run, not a problem with these particular subjects. Running matching again (for just their program, if you want a quicker check) usually succeeds.</p>
                </div>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-red-700 text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
