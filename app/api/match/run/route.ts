import { scoreCandidates, subjectText, subjectQueryTerms, subjectMustQuery, titleText } from "@/lib/matcher";
import type { Candidate } from "@/lib/matcher";
import { serviceClient } from "@/lib/supabase";
import { embedTexts, embeddingsEnabled, cosineSim } from "@/lib/embeddings";
import { ndjsonStream } from "@/lib/streaming";
import { pageThroughParallel } from "@/lib/paging";
import type { SubjectRow } from "@/lib/types";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EMBED_BATCH = 64;
const SEMANTIC_WEIGHT = parseFloat(process.env.MATCH_SEMANTIC_WEIGHT ?? "0.5");
// How many candidate titles Postgres returns per subject (see
// match_titles_candidates in supabase/migrations/08_titles_fulltext_search.sql).
// Bounded and independent of total catalog size -- this is what keeps a
// run's cost from scaling with how many titles have been uploaded overall.
const CANDIDATE_LIMIT = parseInt(process.env.MATCH_CANDIDATE_LIMIT ?? "300", 10);
// How many subjects are searched/scored concurrently per batch. Lower
// reduces load on a free-tier database (each search is expensive enough
// that running many at once can cause contention-driven timeouts even on
// subjects whose own query would normally be fast).
const SUBJECT_CONCURRENCY = parseInt(process.env.MATCH_SUBJECT_CONCURRENCY ?? "5", 10);
// The embedding model downloads from the Hugging Face CDN on a cold start,
// with no built-in timeout on that fetch. If the connection from Vercel's
// serverless region to the CDN stalls, the run would otherwise hang forever
// looking frozen instead of falling back to lexical-only matching.
const EMBED_TIMEOUT_MS = parseInt(process.env.MATCH_EMBED_TIMEOUT_MS ?? "150000", 10);
// Vercel kills the whole function at maxDuration regardless of what it's
// doing -- that's a hard cutoff mid-request, not a clean stopping point. So
// instead of racing that wall, this route watches its own elapsed time and
// stops itself early at a safer margin, reporting exactly how far it got
// (phase "paused") so the client can immediately start a new request picking
// up right where this one left off. A run of any size finishes eventually,
// just as a sequence of bounded requests instead of one that can outrun the
// platform's timeout.
const TIME_BUDGET_MS = parseInt(process.env.MATCH_TIME_BUDGET_MS ?? "240000", 10);

export type MatchProgressEvent =
  | { phase: "fetching"; done: number; total: number; label: string }
  | { phase: "embedding_model" }
  | { phase: "embedding"; done: number; total: number }
  // matches_so_far/failed_so_far are included on every progress tick (not
  // just "paused") so the client can checkpoint after every batch -- if
  // the connection dies mid-run (e.g. the machine sleeps) with no chance
  // to send a "paused" event, the client still has an up-to-date resume
  // point from the last batch that actually committed.
  | { phase: "matching"; done: number; total: number; matches_so_far: number; failed_so_far: { course_code: string; error: string }[] }
  | { phase: "paused"; done: number; total: number; next_offset: number; matches_so_far: number; failed_so_far: { course_code: string; error: string }[] }
  | { phase: "done"; matches: number; subjects: number; titles: number; semantic_used: boolean; locked_skipped: number; failed_subjects: { course_code: string; error: string }[] }
  | { phase: "error"; error: string };

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Fetches pages concurrently (not one at a time) -- for a subjects table
 *  with progress reporting so the UI doesn't look frozen while it loads. */
async function fetchAllWithProgress<T>(
  db: ReturnType<typeof serviceClient>, table: string, columns: string, label: string,
  send: (e: MatchProgressEvent) => void,
  filter?: { col: string; value: number },
): Promise<T[]> {
  return pageThroughParallel<T>(
    (from, to) => {
      // Ordered explicitly by id so a resumed (chunked) run's numeric
      // offset addresses the same subject every time it's fetched.
      let q = db.from(table).select(columns, { count: "exact" }).order("id", { ascending: true }).range(from, to);
      if (filter) q = q.eq(filter.col, filter.value);
      return q as unknown as PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>;
    },
    (done, total) => send({ phase: "fetching", done, total, label }),
  );
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const topK = parseInt(url.searchParams.get("top_k") ?? "10", 10);
  const topKPrintedParam = url.searchParams.get("top_k_printed");
  const topKDigitalParam = url.searchParams.get("top_k_digital");
  const topKPrinted = topKPrintedParam != null ? parseInt(topKPrintedParam, 10) : undefined;
  const topKDigital = topKDigitalParam != null ? parseInt(topKDigitalParam, 10) : undefined;
  const minScore = parseFloat(url.searchParams.get("min_score") ?? "0.05");
  const programId = url.searchParams.get("program_id");
  // Set by the client when continuing a run that paused for time -- see
  // the "paused" phase below.
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const matchesSoFar = parseInt(url.searchParams.get("matches_so_far") ?? "0", 10);
  let failedSoFar: { course_code: string; error: string }[] = [];
  try { failedSoFar = JSON.parse(url.searchParams.get("failed_so_far") ?? "[]"); } catch { /* ignore malformed */ }
  const userEmail = userEmailFromRequest(req);
  const perms = await getUserPermissions(serviceClient(), userEmail);
  if (!perms.isAdmin && !perms.tabs["match"]?.can_edit) {
    return new Response(JSON.stringify({ error: "Your account doesn't have permission to run matching." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const stream = ndjsonStream<MatchProgressEvent>(async (send) => {
    const db = serviceClient();

    const allSubjects = await fetchAllWithProgress<SubjectRow>(
      db, "subjects",
      "id, program_id, course_code, course_title, description, locked",
      "subjects", send,
      programId ? { col: "program_id", value: Number(programId) } : undefined,
    );
    if (!allSubjects.length) {
      send({ phase: "error", error: "Need at least one subject before matching." });
      return;
    }
    // Locked subjects are skipped entirely -- their assignment list (whatever
    // mix of manual and auto-matched titles it currently has) is left
    // untouched by this run.
    const subjects = allSubjects.filter((s) => !s.locked);
    const lockedSkipped = allSubjects.length - subjects.length;
    if (!subjects.length) {
      send({ phase: "error", error: "All selected subjects are locked. Unlock at least one before running matching." });
      return;
    }

    // "estimated" uses the query planner's row estimate instead of a real
    // COUNT(*) -- this is purely informational (shown in the done summary),
    // and an exact count over a 500k+ row table is itself slow enough to
    // risk hitting Supabase's statement timeout.
    const { count: titleCount } = await db.from("titles").select("id", { count: "estimated", head: true });

    // Resuming a paused run: skip subjects already matched in a prior
    // chunk. Ordering is by id (see fetchAllWithProgress), so this offset
    // addresses the same subjects every call.
    const startIndex = Math.min(offset, subjects.length);
    const remainingSubjects = subjects.slice(startIndex);

    const useEmbeddingsThisRun = embeddingsEnabled();
    let subjectEmbeddings: Map<number, number[]> | undefined;
    let semanticUsed = false;
    if (useEmbeddingsThisRun && remainingSubjects.length) {
      try {
        subjectEmbeddings = await withTimeout(
          (async () => {
            send({ phase: "embedding_model" });
            const vecs = await embedTexts(remainingSubjects.map((s) => subjectText(s)));
            const m = new Map<number, number[]>();
            remainingSubjects.forEach((s, i) => m.set(s.id!, vecs[i]));
            return m;
          })(),
          EMBED_TIMEOUT_MS,
          "Embedding",
        );
        semanticUsed = true;
      } catch (embedErr) {
        console.error("Subject embeddings unavailable this run (error or timeout), falling back to lexical-only:", embedErr);
      }
    }

    const titleEmbeddingCache = new Map<number, number[]>();
    let totalMatches = matchesSoFar;
    let done = startIndex;
    // A subject with an unusually broad/generic title can make the
    // candidate query expensive enough to hit Postgres's statement
    // timeout. That subject failing shouldn't take the whole run down with
    // it -- every other subject still gets matched, and this one is
    // reported back so it can be investigated (e.g. re-run alone, or given
    // a more specific title) instead of silently losing everyone's results.
    const failedSubjects: { course_code: string; error: string }[] = [...failedSoFar];
    const runStart = Date.now();
    send({ phase: "matching", done, total: subjects.length, matches_so_far: totalMatches, failed_so_far: failedSubjects });

    for (let i = 0; i < remainingSubjects.length; i += SUBJECT_CONCURRENCY) {
      const batch = remainingSubjects.slice(i, i + SUBJECT_CONCURRENCY);

      // Drop prior auto assignments for just this batch right before
      // replacing them; manual rows are kept. Scoped per-batch (rather
      // than all subjects up front) so a paused/resumed run never touches
      // subjects a prior chunk already finished.
      const batchIds = batch.map((s) => s.id!);
      { const { error } = await db.from("assignments").delete().in("subject_id", batchIds).eq("manual", 0); if (error) throw error; }

      const batchCandidates = await Promise.all(batch.map(async (subject) => {
        const terms = subjectQueryTerms(subject);
        if (!terms.length) return { subject, candidates: [] as Candidate[] };
        // A timeout here is usually transient contention (several subjects'
        // searches running concurrently against a free-tier database), not
        // something wrong with this particular subject -- one retry after
        // a short pause resolves the vast majority of these without
        // needing a manual re-run.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const { data, error } = await db.rpc("match_titles_candidates", {
              query_text: terms.join(" | "),
              must_text: subjectMustQuery(subject),
              limit_n: CANDIDATE_LIMIT,
            });
            if (error) throw new Error(error.message);
            return { subject, candidates: (data ?? []) as Candidate[] };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (attempt === 0) {
              console.warn(`match_titles_candidates failed for subject ${subject.course_code}, retrying:`, message);
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            console.error(`match_titles_candidates failed for subject ${subject.course_code} (after retry):`, message);
            failedSubjects.push({ course_code: subject.course_code ?? String(subject.id), error: message });
            return { subject, candidates: [] as Candidate[] };
          }
        }
        return { subject, candidates: [] as Candidate[] };
      }));

      if (useEmbeddingsThisRun) {
        const missing: { id: number; text: string }[] = [];
        const queued = new Set<number>();
        for (const { candidates } of batchCandidates) {
          for (const c of candidates) {
            if (titleEmbeddingCache.has(c.id) || queued.has(c.id)) continue;
            if (Array.isArray(c.embedding) && c.embedding.length > 0) {
              titleEmbeddingCache.set(c.id, c.embedding);
            } else {
              queued.add(c.id);
              missing.push({ id: c.id, text: titleText(c) });
            }
          }
        }
        if (missing.length) {
          try {
            await withTimeout(
              (async () => {
                for (let j = 0; j < missing.length; j += EMBED_BATCH) {
                  const chunk = missing.slice(j, j + EMBED_BATCH);
                  const vecs = await embedTexts(chunk.map((m) => m.text));
                  const upsertRows = chunk.map((m, k) => {
                    titleEmbeddingCache.set(m.id, vecs[k]);
                    return { id: m.id, embedding: vecs[k] };
                  });
                  const { error } = await db.from("titles").upsert(upsertRows, { onConflict: "id" });
                  if (error) throw error;
                }
              })(),
              EMBED_TIMEOUT_MS,
              "Embedding",
            );
          } catch (embedErr) {
            console.error("Title embeddings unavailable this batch (error or timeout), falling back to lexical-only for these candidates:", embedErr);
          }
        }
      }

      const rows: { subject_id: number; title_id: number; score: number; rank: number; explanation: string; manual: number }[] = [];
      for (const { subject, candidates } of batchCandidates) {
        const results = scoreCandidates(subject, candidates, {
          topK, topKPrinted, topKDigital, minScore,
          semanticWeight: SEMANTIC_WEIGHT,
          subjectEmbedding: subjectEmbeddings?.get(subject.id!),
          titleEmbeddings: titleEmbeddingCache,
          cosineSim: semanticUsed ? cosineSim : undefined,
        });
        totalMatches += results.length;
        for (const r of results) {
          rows.push({
            subject_id: r.subject_id,
            title_id: r.title_id,
            score: r.score!,
            rank: r.rank!,
            explanation: r.explanation ?? "",
            manual: 0,
          });
        }
      }

      if (rows.length) {
        const { error } = await db.from("assignments")
          .upsert(rows, { onConflict: "subject_id,title_id", ignoreDuplicates: true });
        if (error) throw error;
      }

      done += batch.length;
      send({ phase: "matching", done, total: subjects.length, matches_so_far: totalMatches, failed_so_far: failedSubjects });

      if (Date.now() - runStart > TIME_BUDGET_MS && done < subjects.length) {
        send({
          phase: "paused",
          done, total: subjects.length,
          next_offset: done,
          matches_so_far: totalMatches,
          failed_so_far: failedSubjects,
        });
        return;
      }
    }

    send({
      phase: "done",
      matches: totalMatches,
      subjects: subjects.length,
      titles: titleCount ?? 0,
      semantic_used: semanticUsed,
      locked_skipped: lockedSkipped,
      failed_subjects: failedSubjects,
    });
    await logActivity(db, {
      userEmail, action: "match_run",
      summary: `Ran matching${programId ? " (one program)" : " (all programs)"}: ${totalMatches} matches across ${subjects.length} subjects${lockedSkipped ? `, ${lockedSkipped} locked subject${lockedSkipped === 1 ? "" : "s"} skipped` : ""}${failedSubjects.length ? `, ${failedSubjects.length} subject${failedSubjects.length === 1 ? "" : "s"} failed` : ""}`,
      detail: { program_id: programId ?? null, matches: totalMatches, subjects: subjects.length, locked_skipped: lockedSkipped, semantic_used: semanticUsed, failed_subjects: failedSubjects },
    });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
