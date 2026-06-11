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
