import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import type { PersistedPRItem } from "@/lib/purchase-request-items";
import { getClaimedCanvassingIdsForPO } from "@/lib/purchase-order-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConsolidatedItem = {
  stock_prop_no: string; unit: string; description: string; quantity: number; unit_cost: number;
  source_pr_nos: string[];
  canvassing_ids: number[];
};

/** GET /api/purchase-order/consolidated?supplier=NAME -- every line item
 *  across every non-cancelled Purchase Request whose supplier matches,
 *  merged into one line per distinct title (quantities summed, price taken
 *  from the first PR that has it) -- the starting point for the "Generate
 *  Purchase Order" panel in Monitoring, editable before actually
 *  generating. Items already covered by a prior *active* PO are excluded --
 *  otherwise regenerating a PO for the same supplier would silently
 *  re-order titles already on an earlier PO. Cancelling that PO frees them
 *  back up for consolidation. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    const supplier = (new URL(req.url).searchParams.get("supplier") ?? "").trim();
    if (!supplier) return NextResponse.json({ error: "supplier is required" }, { status: 400 });

    const [{ data, error }, alreadyOnPo] = await Promise.all([
      db.from("purchase_requests").select("pr_no, items").neq("status", "cancelled"),
      getClaimedCanvassingIdsForPO(db),
    ]);
    if (error) throw error;

    const merged = new Map<string, ConsolidatedItem>();
    let excludedCount = 0;
    for (const row of data ?? []) {
      const items = (Array.isArray(row.items) ? row.items : []) as PersistedPRItem[];
      for (const item of items) {
        const itemSupplier = (item.supplier || "").trim() || "Unspecified";
        if (itemSupplier.toLowerCase() !== supplier.toLowerCase()) continue;
        if (item.canvassing_id != null && alreadyOnPo.has(item.canvassing_id)) {
          excludedCount++;
          continue;
        }
        const key = item.description;
        if (!merged.has(key)) {
          merged.set(key, {
            stock_prop_no: item.stock_prop_no, unit: item.unit, description: item.description,
            quantity: 0, unit_cost: item.unit_cost, source_pr_nos: [], canvassing_ids: [],
          });
        }
        const m = merged.get(key)!;
        m.quantity += item.quantity;
        if (!m.source_pr_nos.includes(row.pr_no)) m.source_pr_nos.push(row.pr_no);
        if (item.canvassing_id != null && !m.canvassing_ids.includes(item.canvassing_id)) m.canvassing_ids.push(item.canvassing_id);
      }
    }
    return NextResponse.json({ items: Array.from(merged.values()), excludedCount });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
