/**
 * Scores titles (ebook + printed) already retrieved as candidates for a
 * subject (course code, title, description). Two signals, combined:
 *
 * - Lexical (sparse): Postgres full-text search (ts_rank_cd) does the
 *   candidate retrieval and initial ranking server-side, via
 *   match_titles_candidates() (see supabase/migrations/08_titles_fulltext_search.sql).
 *   The titles catalog is far too large (500k+ rows) to download into a
 *   serverless function and rank in memory, so that step now happens in
 *   the database and this module only re-ranks the bounded result.
 * - Sentence embeddings (dense, semantic, optional): re-ranks the
 *   retrieved candidates by thematic overlap even with no shared words.
 *
 * final = semanticWeight * embeddingCosine + (1 - semanticWeight) * lexicalNorm
 *
 * Embeddings are entirely optional (pass none and this is pure lexical) so
 * the caller can degrade gracefully if the embedding model is unavailable.
 */
import type { SubjectRow, TitleRow, AssignmentRow } from "./types";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","has","have",
  "he","her","his","i","if","in","into","is","it","its","of","on","or","s",
  "she","such","that","the","their","then","there","these","they","this",
  "to","was","were","will","with","you","your","we","our","de","la","en",
  "el","los","las","y","con","del","al","introduction","fundamentals",
]);

function unigrams(text: string): string[] {
  const lc = text.toLowerCase();
  const words = lc.match(/[a-z0-9]{2,}/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** Exported so callers can embed the exact same text used for the title side. */
export function titleText(t: TitleRow): string {
  return [t.title, t.author, t.publisher, t.subjects].filter(Boolean).join(" ");
}

export function subjectText(s: SubjectRow): string {
  return [s.course_title, s.description, s.course_code].filter(Boolean).join(" ");
}

// Caps how many terms get OR'd into one query. A subject with a long
// description can produce dozens of unigrams; OR-ing all of them together
// casts an increasingly wide net (more terms = more titles matched = more
// rows Postgres has to rank), so this keeps query breadth -- and therefore
// per-subject query cost -- roughly constant regardless of description
// length. Longer words are kept preferentially as a cheap proxy for
// specificity (e.g. "photosynthesis" over "study").
const MAX_QUERY_TERMS = 12;

/** Unigram terms for a subject, OR'd together (e.g. "biology | genetics")
 *  to build a Postgres to_tsquery expression -- this is what lets the
 *  database find candidate titles instead of the whole catalog being
 *  pulled into memory.
 *
 *  Course title/code words are always included, however short -- they're
 *  the subject's authoritative topic label (e.g. "Constitutional Law"),
 *  so dropping "law" in favor of a longer but generic word pulled from the
 *  description (like "alternatively" or "evaluation") was silently
 *  excluding an obviously-relevant title whose own title/author text only
 *  contained the short, common word. Only the remaining budget is filled
 *  from the free-text description, longest-first. */
export function subjectQueryTerms(s: SubjectRow): string[] {
  const titleTerms = unigrams([s.course_title, s.course_code].filter(Boolean).join(" "));
  const remaining = MAX_QUERY_TERMS - titleTerms.length;
  if (remaining <= 0) return titleTerms.slice(0, MAX_QUERY_TERMS);

  const titleSeen = new Set(titleTerms);
  const descTerms = unigrams(s.description ?? "").filter((t) => !titleSeen.has(t));
  const pickedDesc = descTerms.length <= remaining
    ? descTerms
    : [...descTerms].sort((a, b) => b.length - a.length).slice(0, remaining);
  return [...titleTerms, ...pickedDesc];
}

// Only the "core" part of the course title -- text before any parenthetical
// qualifier/alternate name (e.g. "Constitutional Law I (Political Law)"
// -> "Constitutional Law I") -- and only its first few significant words.
// The course code is deliberately excluded: it's an administrative label
// ("JD301"), never something a book's own title/author text would contain,
// so ANDing it in would make the phrase impossible to satisfy.
const MUST_QUERY_WORDS = 3;

/** AND-of-terms built from just the course title's core words (e.g.
 *  "constitutional & law"), passed as match_titles_candidates' must_text.
 *  Unlike the broad OR query, this is deliberately selective -- a title
 *  matching it is guaranteed to be ranked rather than risking being
 *  dropped by the broad query's row cap on a catalog with 500k+ titles.
 *  Concretely: a subject titled "Constitutional Law I (Political Law)"
 *  produces "constitutional & law", not "constitutional & law & political
 *  & jd301" -- the latter would fail to match a book titled plainly
 *  "Constitutional law", since it mentions neither "political" nor the
 *  course code anywhere in its own text. */
export function subjectMustQuery(s: SubjectRow): string {
  const core = (s.course_title ?? "").split("(")[0];
  return unigrams(core).slice(0, MUST_QUERY_WORDS).join(" & ");
}

export type Candidate = TitleRow & { id: number; embedding: number[] | null; lexical_rank: number };

export type ScoreOptions = {
  topK?: number;
  minScore?: number;
  /** Weight given to semantic (embedding) similarity vs. lexical rank, 0..1.
   *  Ignored (treated as 0) unless both embeddings below are supplied. */
  semanticWeight?: number;
  /** The subject's own embedding vector. */
  subjectEmbedding?: number[];
  /** title.id -> embedding vector */
  titleEmbeddings?: Map<number, number[]>;
  cosineSim?: (a: number[], b: number[]) => number;
};

/** Scores and ranks candidates already retrieved for a single subject.
 *  Pure/synchronous and cheap -- candidates is a bounded list (the SQL
 *  LIMIT), never the full catalog. */
export function scoreCandidates(
  subject: SubjectRow,
  candidates: Candidate[],
  opts: ScoreOptions = {},
): AssignmentRow[] {
  const topK = opts.topK ?? 10;
  const minScore = opts.minScore ?? 0.05;
  if (!candidates.length) return [];

  const useEmbeddings = !!(opts.subjectEmbedding && opts.titleEmbeddings && opts.cosineSim);
  const alpha = useEmbeddings ? Math.min(1, Math.max(0, opts.semanticWeight ?? 0.5)) : 0;
  const subjectTerms = subjectQueryTerms(subject);

  const scored = candidates
    .map((c) => {
      const lexicalNorm = c.lexical_rank / (c.lexical_rank + 1);
      let semantic = 0;
      if (useEmbeddings) {
        const titleVec = opts.titleEmbeddings!.get(c.id);
        if (titleVec) semantic = opts.cosineSim!(opts.subjectEmbedding!, titleVec);
      }
      const score = alpha * semantic + (1 - alpha) * lexicalNorm;
      return { c, score, lexicalNorm, semantic };
    })
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const results: AssignmentRow[] = [];
  let rank = 0;
  for (const { c, score, lexicalNorm, semantic } of scored.slice(0, topK)) {
    rank++;
    const candTokens = new Set(unigrams(titleText(c)));
    const shared = subjectTerms.filter((t) => candTokens.has(t)).slice(0, 5).join(", ") || "n/a";
    const explanation = useEmbeddings
      ? `hybrid=${score.toFixed(3)} (semantic=${semantic.toFixed(3)}, lexical=${lexicalNorm.toFixed(3)}); shared terms: ${shared}`
      : `lexical=${lexicalNorm.toFixed(3)}; shared terms: ${shared}`;
    results.push({
      subject_id: subject.id!,
      title_id: c.id,
      score,
      rank,
      explanation,
    });
  }
  return results;
}
