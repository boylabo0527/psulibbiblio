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
import { RESOURCE_BY_ID, type ResourceTypeId } from "./resources";

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
  // Same override as subjectQueryTerms/subjectMustQuery below -- when set,
  // the semantic embedding is based on it too, so all three matching
  // signals (broad lexical, must-match, semantic) agree on what this
  // course is actually about instead of the description's own wording
  // pulling the embedding toward unrelated context (audience, delivery
  // format, etc.) the same way it can pull lexical ranking off course.
  const keyword = (s.match_keyword ?? "").trim();
  if (keyword) return keyword;
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
  // An admin-set override replaces the normal title/description
  // derivation entirely -- see supabase/migrations/50_subject_match_keyword.sql.
  // Taken literally/directly, not run through description-mining, since
  // the whole point is precise manual control over what this course
  // searches for.
  const keyword = (s.match_keyword ?? "").trim();
  if (keyword) return unigrams(keyword).slice(0, MAX_QUERY_TERMS);

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
const MUST_QUERY_WORDS = 6;

// Course titles often follow "<topic> for <audience>" (e.g. "Thermodynamics
// for Teachers", "Statistics for Engineers", "Chemistry for Non-Majors") --
// the audience half says who the course is FOR, not what a matching book's
// own text needs to contain. ANDing "teachers" into the must-query wrongly
// excludes a book plainly titled "Thermodynamics and Equilibria in Earth
// System Sciences" (real catalog example) from the guaranteed tier just
// because it has no reason to mention "teachers" anywhere in its own title/
// author/publisher/subjects -- leaving it to compete on weak lexical
// overlap against unrelated titles that merely share more of the
// audience-descriptive words pulled from the course description. That's
// exactly the failure mode is_must_match/MUST_MATCH_SCORE_FLOOR exist to
// prevent; a book search using just "thermodynamics" finds it immediately,
// which is what first exposed this.
//
// Only a standalone "for" is treated as this kind of connector -- "and"/
// "with" more often join two topics that are BOTH integral to the course
// (e.g. "Cell and Molecular Biology", "Programming with Python"), where
// dropping everything after them would be wrong instead of lenient.
function stripAudienceQualifier(text: string): string {
  const m = /^(.*?)\bfor\b/i.exec(text);
  return m ? m[1] : text;
}

/** AND-of-terms built from just the course title's core topic words (e.g.
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
  // Same override as subjectQueryTerms above -- an admin-set keyword is
  // the guarantee too, taken as-is (no audience-qualifier stripping;
  // that heuristic is for guessing intent from a catalog title, not for
  // second-guessing an admin's deliberate, precise override).
  const keyword = (s.match_keyword ?? "").trim();
  if (keyword) return unigrams(keyword).slice(0, MUST_QUERY_WORDS).join(" & ");

  const core = stripAudienceQualifier((s.course_title ?? "").split("(")[0]);
  return unigrams(core).slice(0, MUST_QUERY_WORDS).join(" & ");
}

export type Candidate = TitleRow & { id: number; embedding: number[] | null; lexical_rank: number; is_must_match?: boolean };

// ts_rank_cd has no length normalization, so it rewards a title matching
// MORE of the broad query's terms (e.g. one whose subjects/publisher text
// happens to also mention several generic description words) over a
// sparse, minimally-catalogued classic text whose own title *is* the
// subject's exact topic phrase but otherwise has little text to match
// against. A numeric floor alone isn't a hard guarantee -- a description
// match with enough overlapping terms could still approach the same
// range -- so is_must_match candidates are sorted as a strictly higher
// tier below, not just score-boosted. The floor still applies on top,
// mainly so the displayed score/explanation reads sensibly.
const MUST_MATCH_SCORE_FLOOR = 0.8;

// Accreditors' checklists specifically count printed holdings, so a printed
// title that's genuinely relevant should usually outrank an ebook that's
// only slightly more relevant on paper. This is deliberately a modest
// additive nudge, not a hard tier like is_must_match: unlike an exact
// title match (itself strong evidence of relevance), print-vs-digital is a
// policy preference independent of topical fit, so hard-tiering it risks a
// barely-relevant printed book beating a clearly-better-matching ebook.
// Callers who want printed titles guaranteed regardless of relevance
// should use topKPrinted/topKDigital instead.
const PRINT_SCORE_BONUS = 0.06;

// is_must_match candidates (a title whose own text literally contains the
// course's topic phrase) are never capped by topK the way ordinary
// candidates are -- a course with, say, 15 titles that all genuinely
// contain its topic word shouldn't have 5 of them silently dropped just
// because topK happens to be 10. topK still caps everything else (the
// broader, fuzzier candidates); is_must_match ones are added on top of
// that, capped only by this much more generous backstop -- purely to
// guard against a single-word, very generic course title (e.g.
// "Statistics") matching an unreasonable share of the catalog.
const MUST_MATCH_MAX = 50;

export type ScoreOptions = {
  /** Caps how many of the ordinary (non-is_must_match) candidates get
   *  kept. A title whose own text literally contains the subject's topic
   *  phrase isn't limited by this -- see MUST_MATCH_MAX/
   *  selectWithMustPriority -- so the true count selected can exceed
   *  topK when a course's topic word matches more than topK titles. */
  topK?: number;
  /** When set (either one), ignores topK and instead picks the top
   *  topKPrinted printed titles and top topKDigital digital titles
   *  independently by score -- guarantees a subject isn't assigned an
   *  all-digital or all-printed list just because one medium happened to
   *  score higher overall. */
  topKPrinted?: number;
  topKDigital?: number;
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

  const isPrinted = (fmt?: string) => fmt != null && RESOURCE_BY_ID[fmt as ResourceTypeId]?.medium === "print";

  const scored = candidates
    .map((c) => {
      let lexicalNorm = c.lexical_rank / (c.lexical_rank + 1);
      if (c.is_must_match) lexicalNorm = Math.max(lexicalNorm, MUST_MATCH_SCORE_FLOOR);
      let semantic = 0;
      if (useEmbeddings) {
        const titleVec = opts.titleEmbeddings!.get(c.id);
        if (titleVec) semantic = opts.cosineSim!(opts.subjectEmbedding!, titleVec);
      }
      let score = alpha * semantic + (1 - alpha) * lexicalNorm;
      const printed = isPrinted(c.format);
      if (printed) score = Math.min(1, score + PRINT_SCORE_BONUS);
      return { c, score, lexicalNorm, semantic, printed };
    })
    .filter((s) => s.score >= minScore)
    // Course-title matches are a strictly higher tier, not just a score
    // boost -- a title literally matching the subject's name must never
    // be beaten by a title that merely overlaps with more of the
    // (necessarily fuzzier) description text.
    .sort((a, b) => (Number(b.c.is_must_match) - Number(a.c.is_must_match)) || (b.score - a.score));

  // Takes an already tier-sorted pool (is_must_match first) and a
  // requested count: every is_must_match candidate makes it in (up to
  // MUST_MATCH_MAX), and capN only limits how many of the REST get added
  // on top -- so a course with more topic-containing titles than capN
  // gets all of them instead of only the top capN overall.
  function selectWithMustPriority(pool: typeof scored, capN: number): typeof scored {
    const must = pool.filter((s) => s.c.is_must_match).slice(0, MUST_MATCH_MAX);
    const rest = pool.filter((s) => !s.c.is_must_match);
    return [...must, ...rest.slice(0, Math.max(0, capN - must.length))];
  }

  const balanced = opts.topKPrinted != null || opts.topKDigital != null;
  let selected: typeof scored;
  if (balanced) {
    // "printed"/"digital" here specifically means what actually shows
    // under THIS course in Programs & Export -- journals never do (a
    // subscription is program-wide, so it's always pulled out into the
    // program's own Journals section regardless of which course's search
    // happened to find it). journal_printed shares medium:"print" with
    // book_printed, so without this exclusion a "guarantee N printed"
    // quota could get filled with journal matches that then silently
    // vanish from the course's own list -- the course looks like matching
    // did nothing even though titles really were assigned, just not to a
    // slot this course's page will ever display them in.
    const isJournal = (fmt?: string) => fmt != null && RESOURCE_BY_ID[fmt as ResourceTypeId]?.kind === "journal";
    const eligible = scored.filter((s) => !isJournal(s.c.format));
    const printed = selectWithMustPriority(eligible.filter((s) => s.c.format === "book_printed"), opts.topKPrinted ?? 0);
    const digital = selectWithMustPriority(eligible.filter((s) => s.c.format !== "book_printed"), opts.topKDigital ?? 0);
    selected = [...printed, ...digital]
      .sort((a, b) => (Number(b.c.is_must_match) - Number(a.c.is_must_match)) || (b.score - a.score));
  } else {
    selected = selectWithMustPriority(scored, topK);
  }

  const results: AssignmentRow[] = [];
  let rank = 0;
  for (const { c, score, lexicalNorm, semantic, printed } of selected) {
    rank++;
    const candTokens = new Set(unigrams(titleText(c)));
    const shared = subjectTerms.filter((t) => candTokens.has(t)).slice(0, 5).join(", ") || "n/a";
    const mustNote = c.is_must_match ? " (title matches course name exactly)" : "";
    const printNote = printed ? " (printed)" : "";
    const explanation = useEmbeddings
      ? `hybrid=${score.toFixed(3)} (semantic=${semantic.toFixed(3)}, lexical=${lexicalNorm.toFixed(3)}); shared terms: ${shared}${mustNote}${printNote}`
      : `lexical=${lexicalNorm.toFixed(3)}; shared terms: ${shared}${mustNote}${printNote}`;
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
