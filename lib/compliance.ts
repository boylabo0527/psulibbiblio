/** Shared accreditation thresholds for procurement compliance -- used by the
 *  procurement summary, subject table, and campus heatmap. Centralized so
 *  changing the requirement can't leave one of them out of sync with the
 *  others (they used to each hardcode their own copy). */
export const ACCREDITATION_MIN = 3;  // minimum unique recent titles per subject for full compliance
export const PARTIAL_MIN = 2;        // minimum recent titles to count as partial compliance
export const RECENCY_YEARS = 5;      // titles must be published within the last N years

// CMO No. 15, s. 2019: at least 3 professional journal titles (local and
// foreign, print/electronic combined) per undergraduate program; graduate
// programs require 2 more peer-reviewed/internationally-refereed titles in
// addition to those 3. Which of a program's students are undergrad vs.
// graduate isn't tracked in this app's data model, so the UI shows both
// numbers as reference points rather than auto-judging compliance.
export const JOURNAL_MIN_UNDERGRAD = 3;
export const JOURNAL_MIN_GRADUATE_ADDITIONAL = 2;
