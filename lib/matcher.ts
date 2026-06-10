/**
 * TF-IDF + cosine similarity matcher. Pure TypeScript, no native deps.
 * Tuned for thousands of titles and hundreds of courses inside a single
 * serverless function invocation.
 */
import type { CourseRow, TitleRow, MatchRow } from "./types";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","has","have",
  "he","her","his","i","if","in","into","is","it","its","of","on","or","s",
  "she","such","that","the","their","then","there","these","they","this",
  "to","was","were","will","with","you","your","we","our","or","de","la",
  "en","el","los","las","y","con","del","al",
]);

function tokenize(text: string): string[] {
  const lc = text.toLowerCase();
  const unigrams = lc.match(/[a-z0-9]{2,}/g) || [];
  const filtered = unigrams.filter((w) => !STOPWORDS.has(w));
  // Add bigrams from adjacent filtered terms for slightly richer matching.
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < filtered.length; i++) bigrams.push(`${filtered[i]} ${filtered[i + 1]}`);
  return filtered.concat(bigrams);
}

function titleText(t: TitleRow): string {
  return [t.title, t.author, t.publisher, t.subjects].filter(Boolean).join(" ");
}
function courseText(c: CourseRow): string {
  return [c.course_title, c.major, c.program, c.college, c.description, c.learning_outcomes, c.keywords]
    .filter(Boolean)
    .join(" ");
}

type SparseVec = Map<number, number>;

function buildVocab(docs: string[][]): Map<string, number> {
  const vocab = new Map<string, number>();
  for (const tokens of docs) {
    for (const tok of tokens) if (!vocab.has(tok)) vocab.set(tok, vocab.size);
  }
  return vocab;
}

function termFreq(tokens: string[], vocab: Map<string, number>): SparseVec {
  const tf = new Map<number, number>();
  for (const tok of tokens) {
    const id = vocab.get(tok);
    if (id !== undefined) tf.set(id, (tf.get(id) || 0) + 1);
  }
  // sublinear TF
  for (const [k, v] of tf) tf.set(k, 1 + Math.log(v));
  return tf;
}

function tfidf(tf: SparseVec, idf: Float64Array): SparseVec {
  const out = new Map<number, number>();
  for (const [k, v] of tf) out.set(k, v * idf[k]);
  return out;
}

function l2norm(v: SparseVec): number {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s) || 1;
}

function cosine(a: SparseVec, b: SparseVec, an: number, bn: number): number {
  // iterate over smaller map for speed
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w !== undefined) dot += v * w;
  }
  return dot / (an * bn);
}

export type MatchOptions = { topK?: number; minScore?: number };

export function runMatch(
  courses: CourseRow[],
  titles: TitleRow[],
  opts: MatchOptions = {},
): MatchRow[] {
  const topK = opts.topK ?? 10;
  const minScore = opts.minScore ?? 0.05;
  if (!courses.length || !titles.length) return [];

  const courseTokens = courses.map((c) => tokenize(courseText(c)));
  const titleTokens = titles.map((t) => tokenize(titleText(t)));
  const vocab = buildVocab(courseTokens.concat(titleTokens));

  const N = courseTokens.length + titleTokens.length;
  const df = new Float64Array(vocab.size);
  for (const tokens of courseTokens.concat(titleTokens)) {
    const seen = new Set<number>();
    for (const tok of tokens) {
      const id = vocab.get(tok)!;
      if (!seen.has(id)) { df[id]++; seen.add(id); }
    }
  }
  const idf = new Float64Array(vocab.size);
  for (let i = 0; i < vocab.size; i++) idf[i] = Math.log((N + 1) / (df[i] + 1)) + 1;

  const titleVecs = titleTokens.map((toks) => tfidf(termFreq(toks, vocab), idf));
  const titleNorms = titleVecs.map(l2norm);

  // Inverted index: term -> list of title indices that contain it (post-idf, post-tf).
  const inverted: Map<number, number[]> = new Map();
  for (let j = 0; j < titleVecs.length; j++) {
    for (const k of titleVecs[j].keys()) {
      const arr = inverted.get(k);
      if (arr) arr.push(j);
      else inverted.set(k, [j]);
    }
  }

  const idToTerm = new Array<string>(vocab.size);
  for (const [term, id] of vocab) idToTerm[id] = term;

  const results: MatchRow[] = [];
  for (let i = 0; i < courses.length; i++) {
    const cTf = termFreq(courseTokens[i], vocab);
    const cVec = tfidf(cTf, idf);
    const cNorm = l2norm(cVec);
    if (cVec.size === 0) continue;

    // Candidate titles: those that share at least one term.
    const candidates = new Set<number>();
    for (const k of cVec.keys()) {
      const arr = inverted.get(k);
      if (arr) for (const j of arr) candidates.add(j);
    }

    type Scored = { j: number; score: number };
    const scored: Scored[] = [];
    for (const j of candidates) {
      const s = cosine(cVec, titleVecs[j], cNorm, titleNorms[j]);
      if (s >= minScore) scored.push({ j, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    let rank = 0;
    for (const { j, score } of top) {
      rank++;
      // Explanation: top contributing shared terms.
      const contribs: { term: string; v: number }[] = [];
      for (const [k, v] of cVec) {
        const w = titleVecs[j].get(k);
        if (w) contribs.push({ term: idToTerm[k], v: v * w });
      }
      contribs.sort((a, b) => b.v - a.v);
      const topTerms = contribs.slice(0, 5).map((c) => c.term).join(", ") || "n/a";
      results.push({
        course_id: courses[i].id!,
        title_id: titles[j].id!,
        score,
        rank,
        explanation: `cosine=${score.toFixed(3)}; shared terms: ${topTerms}`,
      });
    }
  }
  return results;
}

export function recommendCopies(coursesUsingTitle: number, totalEnrollment: number): number {
  const base = Math.max(1, coursesUsingTitle);
  const enrollFactor = Math.max(0, Math.floor(totalEnrollment / 40));
  return Math.min(20, base + enrollFactor);
}
