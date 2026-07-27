import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { findBarcodeDuplicateGroups, mergeBarcodeDuplicates } from "@/lib/dedupe-barcodes";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/admin/dedupe-barcodes { dryRun } -- finds printed-book title
 *  rows that share a barcode (the same physical copy entered twice, most
 *  often once by manual upload and once by a Destiny sync that didn't
 *  recognize it as the same title because call number/author/campus
 *  didn't normalize to an identical match) and merges each such group
 *  down to one row, the same barcode-aware way a manual "combine titles"
 *  click does -- copies/barcodes are unioned, not summed, so nothing gets
 *  double-counted. dryRun previews what would be merged without changing
 *  anything. Admin-only, since it's a catalog-wide bulk operation. */
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
    const groups = await findBarcodeDuplicateGroups(db);
    if (dryRun) {
      const sample = groups.slice(0, 20).map((g) => ({
        titles: g.map((r) => ({ id: r.id, title: r.title, author: r.author, call_no: r.call_no, campus: r.campus, copies: r.copies })),
      }));
      const rowsToRemove = groups.reduce((n, g) => n + g.length - 1, 0);
      return NextResponse.json({ groups: groups.length, rowsToRemove, sample });
    }

    const result = await mergeBarcodeDuplicates(db, groups);
    await logActivity(db, {
      userEmail, action: "title_merge",
      summary: `Deduped printed books by shared barcode: ${result.groupsMerged} group(s) merged, ${result.rowsRemoved} duplicate row(s) removed`,
      detail: result,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
