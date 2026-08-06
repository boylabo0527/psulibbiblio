import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["pending", "partial", "delivered"] as const;
const STATUS_LABEL: Record<string, string> = { pending: "not yet delivered", partial: "partially delivered", delivered: "delivered" };

/** POST /api/purchase-order/:id/delivery -- tag whether a PO's items have
 *  actually arrived, separate from the PATCH edit endpoint since this is a
 *  status update (like PR's /status route) rather than a header/item edit.
 *  Body: { delivery_status, delivery_notes? }. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase order id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to update delivery status." }, { status: 403 });
    }

    const { data: po, error: poErr } = await db.from("purchase_orders").select("id, po_no, status, delivery_status").eq("id", id).maybeSingle();
    if (poErr) throw poErr;
    if (!po) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
    if (po.status !== "active") {
      return NextResponse.json({ error: "Can't update delivery status on a cancelled purchase order." }, { status: 400 });
    }

    const body = await req.json() as { delivery_status?: string; delivery_notes?: string };
    if (!body.delivery_status || !STATUSES.includes(body.delivery_status as typeof STATUSES[number])) {
      return NextResponse.json({ error: `delivery_status must be one of: ${STATUSES.join(", ")}` }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      delivery_status: body.delivery_status,
      delivered_at: body.delivery_status === "delivered" ? new Date().toISOString() : null,
    };
    if (body.delivery_notes !== undefined) update.delivery_notes = body.delivery_notes.trim();

    const { error } = await db.from("purchase_orders").update(update).eq("id", id);
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "purchase_order_delivery_status",
      summary: `${email} marked purchase order ${po.po_no || "(draft)"} as ${STATUS_LABEL[body.delivery_status]}`,
      detail: { purchase_order_id: id, before: { delivery_status: po.delivery_status }, delivery_status: body.delivery_status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
