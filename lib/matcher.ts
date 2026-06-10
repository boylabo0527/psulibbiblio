/**
 * TF-IDF + cosine similarity matcher matching titles (ebook + printed) to
 * subjects (course code, title, description). Pure TypeScript.
 */
import type { SubjectRow, TitleRow, AssignmentRow } from "./types";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","has","have",
  "he","her","his","i","if","in","into","is","it","its","of","on","or","s",
  "she","such","that","the","their","then","there","these","they","this",
  "to","was","were","will","with","you","your","we","our","de","la","en",
  "el","los","las","y","con","del","al","introduction","fundamentals",
]);

function tokenize(text: string): string[] {
  const lc = text.toLowerCase();
  const unigrams = lc.match(/[a-z0-9]{2,}/g) || [];
  const filtered = unigrams.filter((w) => !STOPWORDS.has(w));
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < filtered.length; i++) bigrams.push(`${filtered[i]} ${filtered[i + 1]}`);
  return filtered.concat(bigrams);
}

function titleText(t: TitleRow): string {
  return [t.title, t.author, t.publisher, t.subjects].filter(Boolean).join(" ");
}

function subjectText(s: SubjectRow): string {
  return [s.course_title, s.description, s.course_code].filter(Boolean).join(" ");
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
  subjects: SubjectRow[],
  titles: TitleRow[],
  opts: MatchOptions = {},
): AssignmentRow[] {
  const topK = opts.topK ?? 10;
  const minScore = opts.minScore ?? 0.05;
  if (!subjects.length || !titles.length) return [];

  const subjectTokens = subjects.map((s) => tokenize(subjectText(s)));
  const titleTokens = titles.map((t) => tokenize(titleText(t)));
  const vocab = buildVocab(subjectTokens.concat(titleTokens));

  const N = subjectTokens.length + titleTokens.length;
  const df = new Float64Array(vocab.size);
  for (const tokens of subjectTokens.concat(titleTokens)) {
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
  const inverted: Map<number, number[]> = new Map();
  for (let j = 0; j < titleVecs.length; j++) {
    for (const k of titleVecs[j].keys()) {
      const arr = inverted.get(k);
      if (arr) arr.push(j); else inverted.set(k, [j]);
    }
  }

  const idToTerm = new Array<string>(vocab.size);
  for (const [term, id] of vocab) idToTerm[id] = term;

  const results: AssignmentRow[] = [];
  for (let i = 0; i < subjects.length; i++) {
    const sVec = tfidf(termFreq(subjectTokens[i], vocab), idf);
    if (sVec.size === 0) continue;
    const sNorm = l2norm(sVec);

    const candidates = new Set<number>();
    for (const k of sVec.keys()) {
      const arr = inverted.get(k);
      if (arr) for (const j of arr) candidates.add(j);
    }

    type Scored = { j: number; score: number };
    const scored: Scored[] = [];
    for (const j of candidates) {
      const s = cosine(sVec, titleVecs[j], sNorm, titleNorms[j]);
      if (s >= minScore) scored.push({ j, score: s });
    }
    scored.sort((a, b) => b.score - a.score);

    let rank = 0;
    for (const { j, score } of scored.slice(0, topK)) {
      rank++;
      const contribs: { term: string; v: number }[] = [];
      for (const [k, v] of sVec) {
        const w = titleVecs[j].get(k);
        if (w) contribs.push({ term: idToTerm[k], v: v * w });
      }
      contribs.sort((a, b) => b.v - a.v);
      const top = contribs.slice(0, 5).map((c) => c.term).join(", ") || "n/a";
      results.push({
        subject_id: subjects[i].id!,
        title_id: titles[j].id!,
        score,
        rank,
        explanation: `cosine=${score.toFixed(3)}; shared terms: ${top}`,
      });
    }
  }
  return results;
}
