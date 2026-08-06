import { generatePurchaseOrderXlsx } from "@/lib/exports-po";
import type { POData } from "@/lib/exports-po";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { getClaimedCanvassingIdsForPO, type PersistedPOItem } from "@/lib/purchase-order-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingPOData = Omit<POData, "items"> & { items: PersistedPOItem[] };

/** POST /api/purchase-order -- generates a Purchase Order xlsx (see
 *  lib/exports-po.ts) from the supplied header fields + line items (the
 *  Monitoring "Generate PO" panel pre-fills items from
 *  /api/purchase-order/consolidated, editable before this is called), and
 *  persists a record for history. Gated the same as the rest of
 *  Monitoring's consolidation/PR actions. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return new Response(JSON.stringify({ error: "Your account doesn't have permission to generate purchase orders." }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    const data: IncomingPOData = await req.json();
    if (!data.items?.length) {
      return new Response(JSON.stringify({ error: "At least one item is required." }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Duplicate prevention -- a title already on a prior active PO can't be
    // silently re-ordered on a new one (mirrors the PR-level check).
    const requestedCanvassingIds = data.items.flatMap((i) => i.canvassing_ids ?? []);
    if (requestedCanvassingIds.length) {
      const claimed = await getClaimedCanvassingIdsForPO(db);
      const conflicts = data.items.filter((i) => (i.canvassing_ids ?? []).some((cid) => claimed.has(cid)));
      if (conflicts.length) {
        const names = conflicts.map((i) => `"${i.description}"`).join(", ");
        return new Response(JSON.stringify({ error: `${conflicts.length} item(s) are already on another active purchase order: ${names}. Reload this panel, or cancel that PO first.` }), {
          status: 409, headers: { "Content-Type": "application/json" },
        });
      }
    }

    const buf = generatePurchaseOrderXlsx(data);
    const filename = `PO_${(data.poNo || "draft").replace(/[^A-Za-z0-9_-]/g, "_")}.xlsx`;

    try {
      const totalAmount = data.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
      const { data: inserted } = await db.from("purchase_orders").insert({
        po_no: data.poNo || "", trans_no: data.transNo || "", philgeps_ref_no: data.philgepsRefNo || "",
        supplier: data.supplier || "", address: data.address || "", tin: data.tin || "",
        mode_of_procurement: data.modeOfProcurement || "", place_of_delivery: data.placeOfDelivery || "",
        delivery_term: data.deliveryTerm || "", date_of_delivery: data.dateOfDelivery || "",
        payment_term: data.paymentTerm || "", fund_cluster: data.fundCluster || "",
        ors_burs_no: data.orsBursNo || "", date_of_ors_burs: data.dateOfOrsBurs || "", po_date: data.date || "",
        items: data.items, total_amount: totalAmount, generated_by: email,
      }).select("id").single();
      await logActivity(db, {
        userEmail: email, action: "purchase_order_generate",
        summary: `${email} generated purchase order ${data.poNo || "(draft)"} for ${data.supplier} — ${data.items.length} item(s), ${totalAmount.toLocaleString()}`,
        detail: { po_no: data.poNo ?? "", supplier: data.supplier, item_count: data.items.length, total_amount: totalAmount, purchase_order_id: inserted?.id ?? null },
        revertible: !!inserted,
      });
    } catch (logErr) {
      console.error("Failed to record purchase_orders row:", logErr);
    }

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as { message?: string })?.message ?? String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
