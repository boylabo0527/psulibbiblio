/** Matching between a library committee's "standard title" entry and the
 *  actual catalog: exact ISBN match if both have one (dashes/spaces
 *  stripped), otherwise a normalized title match -- lowercase, punctuation
 *  stripped, one contains the other. Deliberately strict (this drives a
 *  compliance checklist) rather than the fuzzy relevance scoring used for
 *  course/title matching elsewhere. */
function normalizeIsbn(s: string): string {
  return s.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

export function standardTitleMatches(
  standard: { title: string; isbn: string },
  candidate: { title: string; isbn: string },
): boolean {
  const sIsbn = normalizeIsbn(standard.isbn ?? "");
  const cIsbn = normalizeIsbn(candidate.isbn ?? "");
  if (sIsbn && cIsbn) return sIsbn === cIsbn;

  const sTitle = normalizeTitle(standard.title ?? "");
  const cTitle = normalizeTitle(candidate.title ?? "");
  if (!sTitle || !cTitle) return false;
  return sTitle === cTitle || sTitle.includes(cTitle) || cTitle.includes(sTitle);
}
