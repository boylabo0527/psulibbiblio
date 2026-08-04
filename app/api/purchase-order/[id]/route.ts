import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import type { PersistedPOItem } from "@/lib/purchase-order-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/purchase-order/:id -- full row including line items, for the
 *  Monitoring "Edit" panel to load before showing the form. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase order id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const { data, error } = await db.from("purchase_orders").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
    return NextResponse.json({ po: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type PatchBody = {
  po_no?: string; address?: string; tin?: string; mode_of_procurement?: string;
  place_of_delivery?: string; delivery_term?: string; date_of_delivery?: string; payment_term?: string;
  fund_cluster?: string; ors_burs_no?: string; date_of_ors_burs?: string;
  items?: { quantity: number; unit_cost: number }[]; // positional -- same length/order as the stored items
};

/** PATCH /api/purchase-order/:id -- edit header fields and/or each line
 *  item's quantity/unit cost (not which titles are on it). Blocked once
 *  cancelled. Gated the same as the rest of Monitoring's PO actions. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase order id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to modify purchase orders." }, { status: 403 });
    }

    const { data: po, error: poErr } = await db.from("purchase_orders").select("id, po_no, items, status").eq("id", id).maybeSingle();
    if (poErr) throw poErr;
    if (!po) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
    if (po.status !== "active") {
      return NextResponse.json({ error: "Can't modify a cancelled purchase order." }, { status: 400 });
    }

    const body: PatchBody = await req.json();
    const update: Record<string, unknown> = {};
    const stringFields = [
      "po_no", "address", "tin", "mode_of_procurement", "place_of_delivery", "delivery_term",
      "date_of_delivery", "payment_term", "fund_cluster", "ors_burs_no", "date_of_ors_burs",
    ] as const;
    for (const f of stringFields) {
      if (body[f] !== undefined) update[f] = body[f];
    }

    let totalAmount: number | undefined;
    if (body.items) {
      const existing = (Array.isArray(po.items) ? po.items : []) as PersistedPOItem[];
      if (body.items.length !== existing.length) {
        return NextResponse.json({ error: "Item count mismatch -- reload this purchase order and try again." }, { status: 400 });
      }
      const merged: PersistedPOItem[] = existing.map((item, i) => ({
        ...item,
        quantity: Math.max(1, Number(body.items![i].quantity) || 1),
        unit_cost: Math.max(0, Number(body.items![i].unit_cost) || 0),
      }));
      update.items = merged;
      totalAmount = merged.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
      update.total_amount = totalAmount;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { error: updErr } = await db.from("purchase_orders").update(update).eq("id", id);
    if (updErr) throw updErr;

    await logActivity(db, {
      userEmail: email, action: "purchase_order_edit",
      summary: `${email} edited purchase order ${po.po_no || "(draft)"}`,
      detail: { purchase_order_id: id, fields: Object.keys(update) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
