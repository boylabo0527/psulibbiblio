/** Splits rows into ordered [groupLabel, rows][] buckets by keyFn, or a
 *  single unlabeled bucket when mode is "none" -- shared by every
 *  group-by selector (Monitoring's PR/Proposals tables, Canvassing's
 *  matched-items and supplier-offers tables). */
export function groupRows<T>(rows: T[], mode: string, keyFn: (r: T) => string): [string, T[]][] {
  if (mode === "none") return [["", rows]];
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyFn(r) || "Unspecified";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}
