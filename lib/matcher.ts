/**
 * Matches titles (ebook + printed) to subjects (course code, title,
 * description). Two signals, combined:
 *
 * - BM25 (sparse, lexical): rewards shared exact terms/technical vocabulary
 *   — good for specific course codes, author names, precise terminology.
 * - Sentence embeddings (dense, semantic, optional): rewards thematic
 *   overlap even with no shared words — good for broad subject areas.
 *
 * final = semanticWeight * embeddingCosine + (1 - semanticWeight) * bm25Norm
 *
 * Embeddings are entirely optional (pass none and this is pure BM25) so the
 * caller can degrade gracefully if the embedding model is unavailable.
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

/** Exported so callers can embed the exact same text used for BM25 tokenizing. */
export function titleText(t: TitleRow): string {
  return [t.title, t.author, t.publisher, t.subjects].filter(Boolean).join(" ");
}

export function subjectText(s: SubjectRow): string {
  return [s.course_title, s.description, s.course_code].filter(Boolean).join(" ");
}

function buildVocab(docs: string[][]): Map<string, number> {
  const vocab = new Map<string, number>();
  for (const tokens of docs) {
    for (const tok of tokens) if (!vocab.has(tok)) vocab.set(tok, vocab.size);
  }
  return vocab;
}

function termFreq(tokens: string[], vocab: Map<string, number>): Map<number, number> {
  const tf = new Map<number, number>();
  for (const tok of tokens) {
    const id = vocab.get(tok);
    if (id !== undefined) tf.set(id, (tf.get(id) || 0) + 1);
  }
  return tf;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const DEFAULT_SEMANTIC_WEIGHT = 0.5;

export type MatchOptions = {
  topK?: number;
  minScore?: number;
  /** Weight given to semantic (embedding) similarity vs. BM25, 0..1. Ignored
   *  (treated as 0) unless both embedding maps below are supplied. */
  semanticWeight?: number;
  /** subject.id -> embedding vector */
  subjectEmbeddings?: Map<number, number[]>;
  /** title.id -> embedding vector */
  titleEmbeddings?: Map<number, number[]>;
  cosineSim?: (a: number[], b: number[]) => number;
};

export function runMatch(
  subjects: SubjectRow[],
  titles: TitleRow[],
  opts: MatchOptions = {},
): AssignmentRow[] {
  const topK = opts.topK ?? 10;
  const minScore = opts.minScore ?? 0.05;
  if (!subjects.length || !titles.length) return [];

  const useEmbeddings = !!(opts.subjectEmbeddings && opts.titleEmbeddings && opts.cosineSim);
  const alpha = useEmbeddings ? Math.min(1, Math.max(0, opts.semanticWeight ?? DEFAULT_SEMANTIC_WEIGHT)) : 0;

  const subjectTokens = subjects.map((s) => tokenize(subjectText(s)));
  const titleTokens = titles.map((t) => tokenize(titleText(t)));
  const vocab = buildVocab(subjectTokens.concat(titleTokens));

  // BM25 operates over the title collection: titles are the documents,
  // subjects are queries.
  const N = titleTokens.length;
  const df = new Float64Array(vocab.size);
  for (const tokens of titleTokens) {
    const seen = new Set<number>();
    for (const tok of tokens) {
      const id = vocab.get(tok)!;
      if (!seen.has(id)) { df[id]++; seen.add(id); }
    }
  }
  const idf = new Float64Array(vocab.size);
  for (let i = 0; i < vocab.size; i++) idf[i] = Math.log((N - df[i] + 0.5) / (df[i] + 0.5) + 1);

  const titleTFs = titleTokens.map((toks) => termFreq(toks, vocab));
  const titleLens = titleTokens.map((toks) => toks.length);
  const avgdl = titleLens.reduce((a, b) => a + b, 0) / (titleLens.length || 1) || 1;

  const inverted: Map<number, number[]> = new Map();
  for (let j = 0; j < titleTFs.length; j++) {
    for (const k of titleTFs[j].keys()) {
      const arr = inverted.get(k);
      if (arr) arr.push(j); else inverted.set(k, [j]);
    }
  }

  const idToTerm = new Array<string>(vocab.size);
  for (const [term, id] of vocab) idToTerm[id] = term;

  const results: AssignmentRow[] = [];
  for (let i = 0; i < subjects.length; i++) {
    const qTF = termFreq(subjectTokens[i], vocab);
    if (qTF.size === 0 && !useEmbeddings) continue;

    const candidates = new Set<number>();
    for (const k of qTF.keys()) {
      const arr = inverted.get(k);
      if (arr) for (const j of arr) candidates.add(j);
    }
    // With embeddings on, a subject can still match titles that share no
    // exact terms at all — consider every title as a candidate in that case.
    if (useEmbeddings && candidates.size === 0) {
      for (let j = 0; j < titles.length; j++) candidates.add(j);
    }

    const subjectVec = useEmbeddings ? opts.subjectEmbeddings!.get(subjects[i].id!) : undefined;

    type Scored = { j: number; score: number; bm25: number; semantic: number; termContribs: { term: string; v: number }[] };
    const scored: Scored[] = [];
    for (const j of candidates) {
      const docTF = titleTFs[j];
      const docLen = titleLens[j] || 1;
      let bm25Raw = 0;
      const termContribs: { term: string; v: number }[] = [];
      for (const k of qTF.keys()) {
        const tf = docTF.get(k);
        if (!tf) continue;
        const numerator = tf * (BM25_K1 + 1);
        const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgdl));
        const contrib = idf[k] * (numerator / denominator);
        bm25Raw += contrib;
        termContribs.push({ term: idToTerm[k], v: contrib });
      }
      const bm25Norm = bm25Raw / (bm25Raw + 1);

      let semantic = 0;
      if (useEmbeddings && subjectVec) {
        const titleVec = opts.titleEmbeddings!.get(titles[j].id!);
        if (titleVec) semantic = opts.cosineSim!(subjectVec, titleVec);
      }

      const score = alpha * semantic + (1 - alpha) * bm25Norm;
      if (score >= minScore) scored.push({ j, score, bm25: bm25Norm, semantic, termContribs });
    }
    scored.sort((a, b) => b.score - a.score);

    let rank = 0;
    for (const { j, score, bm25, semantic, termContribs } of scored.slice(0, topK)) {
      rank++;
      termContribs.sort((a, b) => b.v - a.v);
      const top = termContribs.slice(0, 5).map((c) => c.term).join(", ") || "n/a";
      const explanation = useEmbeddings
        ? `hybrid=${score.toFixed(3)} (semantic=${semantic.toFixed(3)}, bm25=${bm25.toFixed(3)}); shared terms: ${top}`
        : `bm25=${score.toFixed(3)}; shared terms: ${top}`;
      results.push({
        subject_id: subjects[i].id!,
        title_id: titles[j].id!,
        score,
        rank,
        explanation,
      });
    }
  }
  return results;
}
