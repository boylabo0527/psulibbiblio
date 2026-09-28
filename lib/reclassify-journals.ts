import type { serviceClient } from "./supabase";
import { pageThroughParallel } from "./paging";

export type MisclassifiedRow = {
  id: number; title: string; author: string; call_no: string; campus: string; barcodes: string[] | null;
};

const isJournalBarcode = (bc: string) => bc.trim().toUpperCase().startsWith("PSUMLJ");

/** Finds Main Campus printed titles filed under the wrong format going by
 *  their own barcodes -- see the barcode split added to /api/sync/destiny
 *  for the underlying rule (a periodical's copy barcode is prefixed
 *  "PSUMLJ", a book's just "PSUML"). That split only classifies rows
 *  going forward; anything synced/uploaded before it exists needs this
 *  one-time pass to catch up. toJournal is book_printed rows where at
 *  least one barcode is actually a journal's; toBook is journal_printed
 *  rows where NONE of the barcodes are (i.e. they're all book-style). */
export async function findMisclassifiedPrintedTitles(
  db: ReturnType<typeof serviceClient>,
): Promise<{ toJournal: MisclassifiedRow[]; toBook: MisclassifiedRow[] }> {
  const fetchFormat = (format: string) => pageThroughParallel<MisclassifiedRow>(
    (from, to) => db.from("titles")
      .select("id, title, author, call_no, campus, barcodes", { count: "exact" })
      .eq("format", format).eq("campus", "Main Campus").not("barcodes", "is", null)
      .order("id", { ascending: true }).range(from, to) as unknown as
      PromiseLike<{ data: MisclassifiedRow[] | null; count: number | null; error: { message: string } | null }>,
  );

  const [bookRows, journalRows] = await Promise.all([
    fetchFormat("book_printed"),
    fetchFormat("journal_printed"),
  ]);

  const toJournal = bookRows.filter((r) => (r.barcodes ?? []).some(isJournalBarcode));
  const toBook = journalRows.filter((r) => (r.barcodes ?? []).length > 0 && !(r.barcodes ?? []).some(isJournalBarcode));

  return { toJournal, toBook };
}

/** Flips each row's format column in place -- same title_id, so any
 *  existing course/program assignment (and its lock state) carries over
 *  unchanged; it just now correctly counts and displays as the other
 *  format everywhere that reads titles.format. */
export async function reclassifyPrintedTitles(
  db: ReturnType<typeof serviceClient>,
  toJournalIds: number[],
  toBookIds: number[],
): Promise<{ toJournal: number; toBook: number }> {
  let toJournal = 0;
  let toBook = 0;
  if (toJournalIds.length) {
    const { data, error } = await db.from("titles").update({ format: "journal_printed" }).in("id", toJournalIds).select("id");
    if (error) throw error;
    toJournal = data?.length ?? 0;
  }
  if (toBookIds.length) {
    const { data, error } = await db.from("titles").update({ format: "book_printed" }).in("id", toBookIds).select("id");
    if (error) throw error;
    toBook = data?.length ?? 0;
  }
  return { toJournal, toBook };
}
