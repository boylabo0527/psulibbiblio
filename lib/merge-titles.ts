import { serviceClient } from "./supabase";

export type MergeableTitle = {
  id: number; format: string; call_no: string; title: string; author: string;
  campus: string; copies: number; barcodes?: string[] | null;
};

/** Combine two title rows into one: copies are summed onto whichever row was
 *  created first, assignments move over (dropping any that would collide),
 *  and the newer row is deleted. Both rows must share a format.
 *
 *  For printed books (accession mode), copies are backed by a barcode per
 *  physical copy -- if the two rows are duplicates of the same book that
 *  both happen to have picked up the same barcode (e.g. one from a manual
 *  upload, one from a Destiny sync that didn't dedupe against it because
 *  the call number/author didn't normalize to an identical match), a
 *  plain sum would double-count that shared copy. Barcoded rows instead
 *  union their barcode lists (so a shared barcode only counts once) and
 *  add back only the copies on each side that had no barcode to begin
 *  with. */
export async function mergeTitles(
  db: ReturnType<typeof serviceClient>, a: MergeableTitle, b: MergeableTitle,
): Promise<MergeableTitle> {
  const keepId = Math.min(a.id, b.id);
  const dropId = Math.max(a.id, b.id);
  const keepRow = keepId === a.id ? a : b;
  const dropRow = keepId === a.id ? b : a;

  const patch: Record<string, unknown> = {};
  if (a.barcodes || b.barcodes) {
    const keepBarcodes = new Set(keepRow.barcodes ?? []);
    const dropBarcodes = new Set(dropRow.barcodes ?? []);
    const unbarcoded = (row: MergeableTitle, barcodeCount: number) => Math.max(0, (row.copies ?? 1) - barcodeCount);
    const keepUnbarcoded = unbarcoded(keepRow, keepBarcodes.size);
    const dropUnbarcoded = unbarcoded(dropRow, dropBarcodes.size);
    const mergedBarcodes = new Set([...keepBarcodes, ...dropBarcodes]);
    patch.barcodes = Array.from(mergedBarcodes);
    patch.copies = mergedBarcodes.size + keepUnbarcoded + dropUnbarcoded;
  } else {
    patch.copies = (keepRow.copies ?? 1) + (dropRow.copies ?? 1);
  }

  const { data: dropAssignments, error: assignErr } = await db.from("assignments")
    .select("id, subject_id").eq("title_id", dropId);
  if (assignErr) throw assignErr;
  for (const asn of dropAssignments ?? []) {
    const { error: updErr } = await db.from("assignments").update({ title_id: keepId }).eq("id", asn.id);
    if (updErr) {
      // Already assigned to the same subject under the kept title — drop the redundant row.
      await db.from("assignments").delete().eq("id", asn.id);
    }
  }

  const { error: patchErr } = await db.from("titles").update(patch).eq("id", keepId);
  if (patchErr) throw patchErr;
  const { error: delErr } = await db.from("titles").delete().eq("id", dropId);
  if (delErr) throw delErr;

  const { data: finalRow, error: finalErr } = await db.from("titles").select().eq("id", keepId).single();
  if (finalErr) throw finalErr;
  return finalRow as MergeableTitle;
}
