/** Shared accreditation thresholds for procurement compliance -- used by the
 *  procurement summary, subject table, and campus heatmap. Centralized so
 *  changing the requirement can't leave one of them out of sync with the
 *  others (they used to each hardcode their own copy). */
export const ACCREDITATION_MIN = 3;  // minimum unique recent titles per subject for full compliance
export const PARTIAL_MIN = 2;        // minimum recent titles to count as partial compliance
export const RECENCY_YEARS = 5;      // titles must be published within the last N years
