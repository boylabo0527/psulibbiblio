import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";
import type { PersistedPRItem } from "@/lib/purchase-request-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tor/options -- the distinct supplier/campus/program/fund
 *  source values available to filter a TOR by, drawn from non-cancelled
 *  Purchase Requests within the caller's campus scope. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    let q = db.from("purchase_requests").select("id, items, campus, fund_source, campus_id").neq("status", "cancelled");
    if (perms.campusIds !== null) {
      q = q.or(`campus_id.is.null,campus_id.in.(${perms.campusIds.join(",") || "-1"})`);
    }
    const { data, error } = await q;
    if (error) throw error;

    const suppliers = new Set<string>();
    const programs = new Set<string>();
    const campuses = new Set<string>();
    const fundSources = new Set<string>();
    for (const pr of data ?? []) {
      if (pr.campus) campuses.add(pr.campus);
      if (pr.fund_source) fundSources.add(pr.fund_source);
      const items = (Array.isArray(pr.items) ? pr.items : []) as PersistedPRItem[];
      for (const item of items) {
        if (item.supplier) suppliers.add(item.supplier);
        if (item.program) programs.add(item.program);
      }
    }

    return NextResponse.json({
      suppliers: Array.from(suppliers).sort(),
      programs: Array.from(programs).sort(),
      campuses: Array.from(campuses).sort(),
      fundSources: Array.from(fundSources).sort(),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
