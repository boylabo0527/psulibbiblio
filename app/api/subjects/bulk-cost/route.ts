import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { subject_id: number; cost_per_title: number | null };

/** POST /api/subjects/bulk-cost -- sets cost_per_title for many subjects at
 *  once in a single statement (see bulk_set_subject_cost in migration 54),
 *  for Procurement Analysis' bulk cost-estimate upload. Same permission
 *  gate as the cost_per_title field of PATCH /api/subjects/:id. A
 *  campus-scoped user silently skips subjects outside their assigned
 *  campuses instead of failing the whole batch, same as other bulk
 *  endpoints in this app (e.g. /api/match/lock/bulk). */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["procurement"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to set cost estimates." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as { items?: Item[] };
    const items = (body.items ?? [])
      .filter((i) => Number.isFinite(Number(i.subject_id)))
      .map((i) => ({
        subject_id: Number(i.subject_id),
        cost_per_title: i.cost_per_title == null ? null : Number(i.cost_per_title),
      }));
    if (!items.length) {
      return NextResponse.json({ error: "No items given." }, { status: 400 });
    }
    for (const i of items) {
      if (i.cost_per_title != null && (!Number.isFinite(i.cost_per_title) || i.cost_per_title < 0)) {
        return NextResponse.json({ error: `Invalid cost for subject ${i.subject_id}: must be a non-negative number.` }, { status: 400 });
      }
    }

    let scoped = items;
    let skipped = 0;
    if (perms.campusIds !== null) {
      const allowedProgramIds = await getAllowedProgramIds(db, perms.campusIds);
      const { data: subjRows } = await db.from("subjects").select("id, program_id").in("id", items.map((i) => i.subject_id));
      const programById = new Map((subjRows ?? []).map((s: { id: number; program_id: number }) => [s.id, s.program_id]));
      scoped = items.filter((i) => {
        const pid = programById.get(i.subject_id);
        return pid != null && allowedProgramIds.has(pid);
      });
      skipped = items.length - scoped.length;
    }
    if (!scoped.length) {
      return NextResponse.json({ error: "None of these subjects are in your assigned campuses." }, { status: 403 });
    }

    const { error } = await db.rpc("bulk_set_subject_cost", {
      p_subject_ids: scoped.map((i) => i.subject_id),
      p_costs: scoped.map((i) => i.cost_per_title),
    });
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "subject_bulk_cost_edit",
      summary: `${email || "Someone"} bulk-set cost estimates for ${scoped.length} subject${scoped.length === 1 ? "" : "s"}`
        + (skipped ? `, ${skipped} skipped (outside assigned campuses)` : ""),
      detail: { updated: scoped.length, skipped },
    });
    return NextResponse.json({ updated: scoped.length, skipped });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
