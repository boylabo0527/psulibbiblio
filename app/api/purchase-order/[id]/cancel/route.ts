import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/purchase-order/:id/cancel -- terminal action. Frees the PO's
 *  line items so a future PO for the same supplier can include them again
 *  (see getClaimedCanvassingIdsForPO, which only looks at status='active').
 *  Once cancelled a PO can't be un-cancelled -- generate a new one instead. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase order id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to cancel purchase orders." }, { status: 403 });
    }

    const { data: po, error: poErr } = await db.from("purchase_orders").select("id, po_no, status").eq("id", id).maybeSingle();
    if (poErr) throw poErr;
    if (!po) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
    if (po.status === "cancelled") return NextResponse.json({ error: "This purchase order is already cancelled." }, { status: 400 });

    const { error: updErr } = await db.from("purchase_orders")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
    if (updErr) throw updErr;

    await logActivity(db, {
      userEmail: email, action: "purchase_order_cancel",
      summary: `${email} cancelled purchase order ${po.po_no || "(draft)"}`,
      detail: { purchase_order_id: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
