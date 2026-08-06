/** Flags a line-item price edit that swung further than a normal
 *  correction would -- a fat-fingered unit cost (e.g. an extra digit) is
 *  the most common real-world "oops" in Purchase Requests/Orders, and it's
 *  cheap to catch mechanically before it reaches a printed document.
 *  Surfaced as `detail.anomalies` on the same activity_log entry as the
 *  edit, not a separate log row -- it's a property of that edit, not an
 *  independent event. */
export type PriceAnomaly = {
  index: number;
  title: string;
  before: number;
  after: number;
  pct_change: number;
};

const ANOMALY_THRESHOLD = 0.3; // 30% swing in either direction

export function detectPriceAnomalies(
  existing: { unit_cost: number; description?: string }[],
  updated: { unit_cost: number }[],
): PriceAnomaly[] {
  const anomalies: PriceAnomaly[] = [];
  existing.forEach((item, i) => {
    const before = Number(item.unit_cost) || 0;
    const after = Number(updated[i]?.unit_cost) || 0;
    if (before <= 0 || after === before) return;
    const pctChange = (after - before) / before;
    if (Math.abs(pctChange) >= ANOMALY_THRESHOLD) {
      anomalies.push({ index: i, title: item.description || `Item ${i + 1}`, before, after, pct_change: pctChange });
    }
  });
  return anomalies;
}
