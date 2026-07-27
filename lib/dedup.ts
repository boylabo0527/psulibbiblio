/** Normalize a string for fuzzy duplicate detection.
 *
 * - lowercase
 * - replace any run of non-alphanumeric characters with a single space
 *   (collapses whitespace, removes punctuation, treats smart quotes the same
 *    as straight quotes, em-dashes the same as hyphens, etc.)
 * - trim
 *
 * Two distinct values that normalize to the same string are treated as
 * duplicates.
 */
export function normalizeForDedup(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Degree abbreviations and their long forms. The keys must already be the
// output of normalizeForDedup (lowercase, no punctuation). Expansion replaces
// the abbreviation token with the long form so "BA Political Science" and
// "Bachelor of Arts in Political Science" collapse to the same key.
const DEGREE_EXPANSIONS: Record<string, string> = {
  ba: "bachelor of arts",
  bs: "bachelor of science",
  bsc: "bachelor of science",
  bse: "bachelor of science in education",
  bsed: "bachelor of secondary education",
  bsee: "bachelor of science in electrical engineering",
  bsce: "bachelor of science in civil engineering",
  bsme: "bachelor of science in mechanical engineering",
  bsit: "bachelor of science in information technology",
  bscs: "bachelor of science in computer science",
  bsa: "bachelor of science in accountancy",
  bsba: "bachelor of science in business administration",
  bsn: "bachelor of science in nursing",
  beed: "bachelor of elementary education",
  bped: "bachelor of physical education",
  bsbio: "bachelor of science in biology",
  ab: "bachelor of arts",
  ma: "master of arts",
  ms: "master of science",
  msc: "master of science",
  mba: "master in business administration",
  med: "master in education",
  mpa: "master in public administration",
  phd: "doctor of philosophy",
  edd: "doctor of education",
};

// Filler words that don't change the meaning of a degree name.
const STOP_WORDS = new Set(["in", "of", "the", "a", "and", "for", "on"]);

/** Normalize a degree / program name. On top of normalizeForDedup this:
 *  - expands common Philippine degree abbreviations (BA, BS, BSCS, …)
 *  - drops stop words (in, of, the, a, and, for, on)
 *
 *  So "BA Political Science" and "Bachelor of Arts in Political Science"
 *  both normalize to "bachelor arts political science".
 */
export function normalizeProgramName(s: string | null | undefined): string {
  const base = normalizeForDedup(s);
  if (!base) return "";
  const tokens = base.split(" ");
  const expanded: string[] = [];
  for (const tok of tokens) {
    const long = DEGREE_EXPANSIONS[tok];
    if (long) expanded.push(...long.split(" "));
    else expanded.push(tok);
  }
  return expanded.filter((t) => t && !STOP_WORDS.has(t)).join(" ");
}
