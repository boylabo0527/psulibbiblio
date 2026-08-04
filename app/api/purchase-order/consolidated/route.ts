import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import type { PersistedPRItem } from "@/lib/purchase-request-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConsolidatedItem = {
  stock_prop_no: string; unit: string; description: string; quantity: number; unit_cost: number;
  source_pr_nos: string[];
};

/** GET /api/purchase-order/consolidated?supplier=NAME -- every line item
 *  across every non-cancelled Purchase Request whose supplier matches,
 *  merged into one line per distinct title (quantities summed, price taken
 *  from the first PR that has it) -- the starting point for the "Generate
 *  Purchase Order" panel in Monitoring, editable before actually
 *  generating. */
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

    const { data, error } = await db.from("purchase_requests")
      .select("pr_no, items").neq("status", "cancelled");
    if (error) throw error;

    const merged = new Map<string, ConsolidatedItem>();
    for (const row of data ?? []) {
      const items = (Array.isArray(row.items) ? row.items : []) as PersistedPRItem[];
      for (const item of items) {
        const itemSupplier = (item.supplier || "").trim() || "Unspecified";
        if (itemSupplier.toLowerCase() !== supplier.toLowerCase()) continue;
        const key = item.description;
        if (!merged.has(key)) {
          merged.set(key, {
            stock_prop_no: item.stock_prop_no, unit: item.unit, description: item.description,
            quantity: 0, unit_cost: item.unit_cost, source_pr_nos: [],
          });
        }
        const m = merged.get(key)!;
        m.quantity += item.quantity;
        if (!m.source_pr_nos.includes(row.pr_no)) m.source_pr_nos.push(row.pr_no);
      }
    }
    return NextResponse.json({ items: Array.from(merged.values()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
