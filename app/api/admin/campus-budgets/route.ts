import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/campus-budgets -- every campus's budget across every
 *  period an admin has set one for. Viewable by anyone who can see
 *  Monitoring (they need the numbers), editable admin-only (see PUT). */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    const { data, error } = await db.from("campus_budgets").select("id, campus_id, period, amount, updated_at, updated_by");
    if (error) throw error;
    return NextResponse.json({ budgets: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** PUT /api/admin/campus-budgets -- set (upsert) one campus's budget for
 *  one period. Body: { campus_id, period, amount }. Admin-only -- this is
 *  a real allocation decision, not something any Monitoring viewer should
 *  be able to change. */
export async function PUT(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin) return NextResponse.json({ error: "Only an admin can set campus budgets." }, { status: 403 });

    const body = await req.json() as { campus_id?: number; period?: string; amount?: number };
    const campusId = body.campus_id;
    const period = (body.period ?? "").trim();
    const amount = Number(body.amount);
    if (!Number.isFinite(campusId) || !period || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: "campus_id, period, and a non-negative amount are required." }, { status: 400 });
    }

    const { data: campus } = await db.from("campuses").select("name").eq("id", campusId as number).maybeSingle();
    if (!campus) return NextResponse.json({ error: "Campus not found" }, { status: 404 });

    const { error } = await db.from("campus_budgets").upsert(
      { campus_id: campusId, period, amount, updated_at: new Date().toISOString(), updated_by: email },
      { onConflict: "campus_id,period" },
    );
    if (error) throw error;
    await logActivity(db, {
      userEmail: email, action: "campus_budget_set",
      summary: `Set ${campus.name}'s ${period} budget to ${amount.toLocaleString()}`,
      detail: { campus_id: campusId, period, amount },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}
