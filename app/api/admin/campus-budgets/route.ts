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

/** PUT /api/admin/campus-budgets -- set (upsert) one campus's budget for one
 *  period. Body: { campus_id, period, amount }, or { campus_id: null, ... }
 *  for the "University-wide / Digital" budget line -- for Purchase Requests
 *  that aren't tied to one physical campus (typically ebook-only requests),
 *  which otherwise had nowhere to be tracked. Admin-only -- this is a real
 *  allocation decision, not something any Monitoring viewer should change.
 *  campus_id null can't reuse the normal upsert's onConflict (a unique
 *  index column list can't express the "campus_id is null" partial index
 *  it needs to target), so that case is a manual select-then-write. */
export async function PUT(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin) return NextResponse.json({ error: "Only an admin can set campus budgets." }, { status: 403 });

    const body = await req.json() as { campus_id?: number | null; period?: string; amount?: number };
    const isUniversityWide = body.campus_id === null;
    const campusId = isUniversityWide ? null : Number(body.campus_id);
    const period = (body.period ?? "").trim();
    const amount = Number(body.amount);
    if ((!isUniversityWide && !Number.isFinite(campusId)) || !period || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: "campus_id, period, and a non-negative amount are required." }, { status: 400 });
    }

    let campusName = "University-wide / Digital";
    if (!isUniversityWide) {
      const { data: campus } = await db.from("campuses").select("name").eq("id", campusId as number).maybeSingle();
      if (!campus) return NextResponse.json({ error: "Campus not found" }, { status: 404 });
      campusName = campus.name;
    }

    if (isUniversityWide) {
      const { data: existing } = await db.from("campus_budgets").select("id").is("campus_id", null).eq("period", period).maybeSingle();
      const patch = { campus_id: null, period, amount, updated_at: new Date().toISOString(), updated_by: email };
      const { error } = existing
        ? await db.from("campus_budgets").update(patch).eq("id", existing.id)
        : await db.from("campus_budgets").insert(patch);
      if (error) throw error;
    } else {
      const { error } = await db.from("campus_budgets").upsert(
        { campus_id: campusId, period, amount, updated_at: new Date().toISOString(), updated_by: email },
        { onConflict: "campus_id,period" },
      );
      if (error) throw error;
    }
    await logActivity(db, {
      userEmail: email, action: "campus_budget_set",
      summary: `Set ${campusName}'s ${period} budget to ${amount.toLocaleString()}`,
      detail: { campus_id: campusId, period, amount },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}
