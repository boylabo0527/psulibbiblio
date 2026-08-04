import type { PRItem } from "./exports-pr";
import type { serviceClient } from "./supabase";

/** What's persisted per line item in purchase_orders.items (jsonb) --
 *  canvassing_ids is which canvassing rows this merged line covers (a PO
 *  line can consolidate the same title requested across multiple PRs), and
 *  is what excludes them from future consolidation while this PO is active. */
export type PersistedPOItem = PRItem & { canvassing_ids?: number[] };

/** canvassing.id -> the (active) purchase_orders row that already includes
 *  it. Regenerating a PO for a supplier must not silently re-order a title
 *  that's already on a prior active PO -- cancelling that PO frees it back
 *  up for consolidation, same lifecycle as getClaimedCanvassingIds for PRs. */
export async function getClaimedCanvassingIdsForPO(
  db: ReturnType<typeof serviceClient>,
): Promise<Map<number, { po_id: number; po_no: string }>> {
  const { data, error } = await db.from("purchase_orders").select("id, po_no, items").eq("status", "active");
  if (error) throw error;
  const map = new Map<number, { po_id: number; po_no: string }>();
  for (const row of data ?? []) {
    const items = (Array.isArray(row.items) ? row.items : []) as PersistedPOItem[];
    for (const item of items) {
      for (const cid of item.canvassing_ids ?? []) {
        if (!map.has(cid)) map.set(cid, { po_id: row.id, po_no: row.po_no });
      }
    }
  }
  return map;
}
