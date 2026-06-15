/**
 * Resource types stored in titles.format.
 *
 * - id: stored value (also the URL slug for /api/upload/[type])
 * - uiLabel: shown on upload cards and tabs
 * - sectionLabel: header shown in per-subject exports
 * - kind: book | journal — affects parser column aliases and field shown
 * - access: paid | open — used for nice grouping in summary outputs
 * - medium: print | digital
 * - dedupBy: keys used to detect duplicates on re-upload
 */
export const RESOURCE_TYPES = [
  {
    id: "ebook_paid",
    uiLabel: "Paid / Subscribed eBooks",
    sectionLabel: "Subscribed eBooks (Kavita)",
    kind: "book",  access: "paid", medium: "digital",
    campusScoped: false,
    dedupBy: "isbn-or-tuple",
  },
  {
    id: "ebook_open",
    uiLabel: "Open Source eBooks",
    sectionLabel: "Open Source eBooks",
    kind: "book",  access: "open", medium: "digital",
    campusScoped: false,
    dedupBy: "isbn-or-tuple",
  },
  {
    id: "book_printed",
    uiLabel: "Printed Books",
    sectionLabel: "Printed Books",
    kind: "book",  access: "paid", medium: "print",
    campusScoped: true,
    dedupBy: "callno-title-author",
    accessionMode: true as boolean,  // each row = 1 accession; duplicates accumulate copies
  },
  {
    id: "journal_printed",
    uiLabel: "Printed Journals",
    sectionLabel: "Printed Journals",
    kind: "journal", access: "paid", medium: "print",
    campusScoped: true,
    dedupBy: "callno-title-issn",
  },
  {
    id: "journal_online_paid",
    uiLabel: "Subscribed Online Journals",
    sectionLabel: "Subscribed Online Journals",
    kind: "journal", access: "paid", medium: "digital",
    campusScoped: false,
    dedupBy: "issn-or-title",
  },
  {
    id: "journal_online_open",
    uiLabel: "Open Source Online Journals",
    sectionLabel: "Open Source Online Journals",
    kind: "journal", access: "open", medium: "digital",
    campusScoped: false,
    dedupBy: "issn-or-title",
  },
] as const;

export type ResourceTypeId = (typeof RESOURCE_TYPES)[number]["id"];
export type ResourceType = (typeof RESOURCE_TYPES)[number] & { accessionMode?: boolean };

export const RESOURCE_BY_ID: Record<ResourceTypeId, ResourceType> =
  Object.fromEntries(RESOURCE_TYPES.map((t) => [t.id, t])) as Record<ResourceTypeId, ResourceType>;

export function isResourceTypeId(s: string): s is ResourceTypeId {
  return s in RESOURCE_BY_ID;
}
