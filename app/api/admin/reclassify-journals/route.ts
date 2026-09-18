import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { findMisclassifiedPrintedTitles, reclassifyPrintedTitles } from "@/lib/reclassify-journals";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/admin/reclassify-journals { dryRun } -- one-time catch-up for
 *  Main Campus printed titles synced/uploaded before the Destiny sync
 *  started splitting books from journals by barcode (see /api/sync/
 *  destiny): a book_printed row with a "PSUMLJ"-prefixed barcode is
 *  actually a journal, and vice versa. dryRun (default) previews the
 *  affected rows without changing anything. Admin-only, since it's a
 *  catalog-wide bulk operation. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can run this." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false;

  try {
    const { toJournal, toBook } = await findMisclassifiedPrintedTitles(db);
    if (dryRun) {
      return NextResponse.json({
        toJournal: toJournal.length,
        toBook: toBook.length,
        sample: {
          toJournal: toJournal.slice(0, 20).map((r) => ({ id: r.id, title: r.title, call_no: r.call_no, barcodes: r.barcodes })),
          toBook: toBook.slice(0, 20).map((r) => ({ id: r.id, title: r.title, call_no: r.call_no, barcodes: r.barcodes })),
        },
      });
    }

    const result = await reclassifyPrintedTitles(db, toJournal.map((r) => r.id), toBook.map((r) => r.id));
    await logActivity(db, {
      userEmail, action: "reclassify_journals",
      summary: `Reclassified Main Campus printed titles by barcode: ${result.toJournal} book${result.toJournal === 1 ? "" : "s"} -> journal, ${result.toBook} journal${result.toBook === 1 ? "" : "s"} -> book`,
      detail: result,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
