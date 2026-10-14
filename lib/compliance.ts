/** Shared accreditation thresholds for procurement compliance -- used by the
 *  procurement summary, subject table, campus heatmap, and supplier needs
 *  list. Centralized so changing the requirement can't leave one of them out
 *  of sync with the others (they used to each hardcode their own copy). */
export const ACCREDITATION_MIN = 3;  // minimum recent book titles (printed + ebook) per subject for full compliance
export const PARTIAL_MIN = 2;        // minimum recent book titles to count as partial compliance
export const RECENCY_YEARS = 5;      // titles must be published within the last N years
export const MIN_PRINTED_BOOKS = 1;  // at least this many of those recent titles must be a printed book

// Formats that count toward the ACCREDITATION_MIN book minimum: printed
// books and every ebook variant. Journals (governed separately by the CMO
// No. 15 check in ProgramJournalsPanel) and the institutional repository
// are intentionally excluded -- this rule is specifically "printed and
// ebook", not every resource type a subject might have assigned.
const BOOK_COMPLIANCE_FORMATS = new Set(["book_printed", "ebook_paid", "ebook_open", "ebook_complementary"]);

export function countsTowardBookCompliance(format: string): boolean {
  return BOOK_COMPLIANCE_FORMATS.has(format);
}

export function isPrintedBook(format: string): boolean {
  return format === "book_printed";
}

/** Applies the accreditation rule to one subject's (optionally per-campus,
 *  since printed copies are campus-scoped) recent counts: at least
 *  ACCREDITATION_MIN recent titles total (printed + ebook combined), AND at
 *  least MIN_PRINTED_BOOKS of those must specifically be a recent printed
 *  book -- 3 ebooks and zero printed copies is not compliant. gap is the
 *  minimum number of additional titles needed to satisfy both at once (not
 *  simply additive, since a newly-added printed book counts toward both). */
export function evaluateBookCompliance(recentBookTitles: number, recentPrintedTitles: number): {
  compliant: boolean; partial: boolean; gap: number;
} {
  const totalGap = Math.max(0, ACCREDITATION_MIN - recentBookTitles);
  const printedGap = Math.max(0, MIN_PRINTED_BOOKS - recentPrintedTitles);
  const compliant = recentBookTitles >= ACCREDITATION_MIN && recentPrintedTitles >= MIN_PRINTED_BOOKS;
  return { compliant, partial: !compliant && recentBookTitles >= PARTIAL_MIN, gap: Math.max(totalGap, printedGap) };
}

/** How many more titles a subject genuinely still needs sourced, after
 *  crediting whatever's already on an active (non-cancelled) Purchase
 *  Request/Order but not yet catalogued -- see ProcurementRow.pending_titles
 *  in app/api/procurement/route.ts. `gap` itself stays the raw compliance
 *  number (catalogued titles only, used for accreditation reporting); this
 *  is what staff should act on to avoid canvassing/requesting titles a
 *  course doesn't actually need any more of. */
export function stillToSource(r: { gap: number; pending_titles: number }): number {
  return Math.max(0, r.gap - r.pending_titles);
}

// CMO No. 15, s. 2019: at least 3 professional journal titles (local and
// foreign, print/electronic combined) per undergraduate program; graduate
// programs require 2 more peer-reviewed/internationally-refereed titles in
// addition to those 3. Which of a program's students are undergrad vs.
// graduate isn't tracked in this app's data model, so the UI shows both
// numbers as reference points rather than auto-judging compliance.
export const JOURNAL_MIN_UNDERGRAD = 3;
export const JOURNAL_MIN_GRADUATE_ADDITIONAL = 2;
