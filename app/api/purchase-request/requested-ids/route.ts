import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { getClaimedCanvassingIds } from "@/lib/purchase-request-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/purchase-request/requested-ids -- which canvassing rows are
 *  already on a non-cancelled Purchase Request, so PurchaseRequestTab can
 *  exclude them from the pickable item list (a title shouldn't be
 *  requested twice while its first request is still active). Cancelling a
 *  PR frees its items back up. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["purchase-request"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    const claimed = await getClaimedCanvassingIds(db);
    const entries = Array.from(claimed.entries()).map(([canvassing_id, ref]) => ({ canvassing_id, ...ref }));
    return NextResponse.json({ claimed: entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
