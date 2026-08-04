import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PurchaseRequestRow = {
  id: number;
  pr_no: string;
  submitted_by: string;
  office: string;
  purpose: string;
  item_count: number;
  total_amount: number;
  created_at: string;
};

/** GET /api/monitoring -- recent Purchase Requests generated (from the
 *  purchase_requests table, written by /api/purchase-request) and recent
 *  proposals (supplier_offers) submitted, for the Monitoring tab. Gated the
 *  same way as any other per-tab permission: isAdmin or explicit view
 *  access to the "monitoring" tab. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const [prRes, offersRes] = await Promise.all([
      db.from("purchase_requests")
        .select("id, pr_no, submitted_by, office, purpose, items, total_amount, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("supplier_offers").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    if (prRes.error) throw prRes.error;
    if (offersRes.error) throw offersRes.error;

    const purchaseRequests: PurchaseRequestRow[] = (prRes.data ?? []).map((r) => ({
      id: r.id, pr_no: r.pr_no, submitted_by: r.submitted_by, office: r.office,
      purpose: r.purpose, item_count: Array.isArray(r.items) ? r.items.length : 0,
      total_amount: Number(r.total_amount ?? 0), created_at: r.created_at,
    }));

    const offers = offersRes.data ?? [];
    const subjectIds = Array.from(new Set(offers.map((o) => o.subject_id).filter((id): id is number => id != null)));
    const labelMap = new Map<number, string>();
    if (subjectIds.length) {
      const { data: subs } = await db.from("subjects").select("id, course_code, course_title").in("id", subjectIds);
      for (const s of subs ?? []) labelMap.set(s.id, [s.course_code, s.course_title].filter(Boolean).join(" — "));
    }
    const proposals = offers.map((o) => ({
      ...o,
      subject_label: o.subject_id != null ? labelMap.get(o.subject_id) ?? "" : "",
    }));

    return NextResponse.json({ purchaseRequests, proposals });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
