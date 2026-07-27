import type { serviceClient } from "./supabase";
import { pageThroughParallel } from "./paging";
import { mergeTitles, type MergeableTitle } from "./merge-titles";

export type BarcodeDupRow = {
  id: number; format: string; call_no: string; title: string; author: string;
  campus: string; copies: number; barcodes: string[] | null;
};

/** Finds groups of printed-book title rows that share at least one
 *  barcode -- an unambiguous signal they're duplicate entries for the same
 *  physical copy, however differently their call number/author/title
 *  ended up typed or synced (e.g. once from a manual upload, once from a
 *  Destiny sync that didn't dedupe against it because those fields didn't
 *  normalize to an identical match -- the accession-mode dedup key in
 *  lib/ingest-titles.ts is call_no+title+author+campus, not barcode).
 *  Union-find over shared barcodes, so a chain of 3+ rows sharing
 *  barcodes pairwise still comes back as one group instead of separate
 *  overlapping pairs. */
export async function findBarcodeDuplicateGroups(
  db: ReturnType<typeof serviceClient>,
): Promise<BarcodeDupRow[][]> {
  const rows = await pageThroughParallel<BarcodeDupRow>(
    (from, to) => db.from("titles")
      .select("id, format, call_no, title, author, campus, copies, barcodes", { count: "exact" })
      .eq("format", "book_printed").not("barcodes", "is", null)
      .order("id", { ascending: true }).range(from, to) as unknown as
      PromiseLike<{ data: BarcodeDupRow[] | null; count: number | null; error: { message: string } | null }>,
  );

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (x: number, y: number) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  const byId = new Map<number, BarcodeDupRow>();
  const barcodeOwner = new Map<string, number>();
  for (const r of rows) {
    byId.set(r.id, r);
    parent.set(r.id, r.id);
  }
  for (const r of rows) {
    for (const bc of r.barcodes ?? []) {
      const trimmed = bc.trim();
      if (!trimmed) continue;
      const owner = barcodeOwner.get(trimmed);
      if (owner != null && owner !== r.id) union(owner, r.id);
      else barcodeOwner.set(trimmed, r.id);
    }
  }

  const groups = new Map<number, number[]>();
  for (const r of rows) {
    const root = find(r.id);
    const list = groups.get(root);
    if (list) list.push(r.id); else groups.set(root, [r.id]);
  }

  return Array.from(groups.values())
    .filter((ids) => ids.length > 1)
    .map((ids) => ids.map((id) => byId.get(id)!).sort((x, y) => x.id - y.id));
}

/** Merges every duplicate group down to one row each, using the same
 *  barcode-aware mergeTitles a manual "combine titles" click uses (copies
 *  and barcode lists are unioned, not summed, so a barcode shared between
 *  the two duplicate rows only counts once). */
export async function mergeBarcodeDuplicates(
  db: ReturnType<typeof serviceClient>, groups: BarcodeDupRow[][],
): Promise<{ groupsMerged: number; rowsRemoved: number; details: { keptTitle: string; removedCount: number }[] }> {
  let rowsRemoved = 0;
  const details: { keptTitle: string; removedCount: number }[] = [];
  for (const group of groups) {
    let kept: MergeableTitle = group[0];
    for (const next of group.slice(1)) {
      kept = await mergeTitles(db, kept, next);
      rowsRemoved++;
    }
    details.push({ keptTitle: kept.title, removedCount: group.length - 1 });
  }
  return { groupsMerged: groups.length, rowsRemoved, details };
}
