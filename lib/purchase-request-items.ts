import type { PRItem } from "./exports-pr";
import type { serviceClient } from "./supabase";

/** What's actually persisted per line item in purchase_requests.items
 *  (jsonb) -- a superset of what generatePurchaseRequestXlsx needs
 *  (PRItem): supplier/program are for Monitoring's consolidation
 *  rollups, canvassing_id is what /api/purchase-request/requested-ids uses
 *  to detect a title being requested twice across separate PRs. */
export type PersistedPRItem = PRItem & {
  supplier?: string;
  program?: string;
  canvassing_id?: number | null;
};

/** canvassing.id -> the (non-cancelled) purchase_requests row that already
 *  claims it -- a title should only ever be on one active PR at a time.
 *  Cancelling a PR frees its items back up (this only looks at
 *  status != 'cancelled'), which is the whole point of cancel existing.
 *  Shared by the POST duplicate-check and GET /requested-ids so they can
 *  never disagree with each other. */
export async function getClaimedCanvassingIds(
  db: ReturnType<typeof serviceClient>,
): Promise<Map<number, { pr_id: number; pr_no: string }>> {
  const { data, error } = await db.from("purchase_requests").select("id, pr_no, items").neq("status", "cancelled");
  if (error) throw error;
  const map = new Map<number, { pr_id: number; pr_no: string }>();
  for (const row of data ?? []) {
    const items = (Array.isArray(row.items) ? row.items : []) as PersistedPRItem[];
    for (const item of items) {
      if (item.canvassing_id != null && !map.has(item.canvassing_id)) {
        map.set(item.canvassing_id, { pr_id: row.id, pr_no: row.pr_no });
      }
    }
  }
  return map;
}
