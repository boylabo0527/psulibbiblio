/** Extract a 4-digit year from a free-text year field (e.g. "c2019", "©2020", "2018-2019"). */
export function parseYear(y: string | null | undefined): number | null {
  if (!y) return null;
  const m = /\d{4}/.exec(y);
  if (!m) return null;
  return parseInt(m[0], 10);
}

/** True if a title's year falls within [minYear, maxYear] (either bound optional).
 *  Titles whose year can't be parsed are kept — the filter narrows a set of
 *  known dates, it shouldn't hide titles just because the year field is messy. */
export function yearInRange(year: string | null | undefined, minYear?: number, maxYear?: number): boolean {
  if (!minYear && !maxYear) return true;
  const y = parseYear(year);
  if (y === null) return true;
  if (minYear && y < minYear) return false;
  if (maxYear && y > maxYear) return false;
  return true;
}
