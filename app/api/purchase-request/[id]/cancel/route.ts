import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isCampusInScope } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/purchase-request/:id/cancel -- terminal action, distinct from
 *  the free-form status endpoint so cancelling can't happen by accidentally
 *  picking the wrong dropdown option. Frees the PR's line items so they can
 *  be requested again (see getClaimedCanvassingIds, which only looks at
 *  status != 'cancelled'). Once cancelled a PR can't be un-cancelled --
 *  generate a new one instead. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase request id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to cancel purchase requests." }, { status: 403 });
    }

    const { data: pr, error: prErr } = await db.from("purchase_requests")
      .select("id, pr_no, status, current_step_seq, step_entered_at, campus_id")
      .eq("id", id).maybeSingle();
    if (prErr) throw prErr;
    if (!pr) return NextResponse.json({ error: "Purchase request not found." }, { status: 404 });
    if (!isCampusInScope(perms, pr.campus_id)) {
      return NextResponse.json({ error: "This purchase request isn't in your assigned campus(es)." }, { status: 403 });
    }
    if (pr.status === "cancelled") return NextResponse.json({ error: "This purchase request is already cancelled." }, { status: 400 });

    const now = new Date().toISOString();
    const { error: updErr } = await db.from("purchase_requests")
      .update({ status: "cancelled", cancelled_at: now }).eq("id", id);
    if (updErr) throw updErr;

    let historyId: number | null = null;
    if (pr.current_step_seq != null) {
      const { data: histRows } = await db.from("pr_step_history")
        .update({ left_at: now })
        .eq("purchase_request_id", id).eq("seq", pr.current_step_seq).is("left_at", null)
        .select("id");
      historyId = histRows?.[0]?.id ?? null;
    }

    await logActivity(db, {
      userEmail: email, action: "purchase_request_cancel",
      summary: `${email} cancelled purchase request ${pr.pr_no || "(draft)"}`,
      detail: {
        purchase_request_id: id,
        before: { status: pr.status, current_step_seq: pr.current_step_seq, step_entered_at: pr.step_entered_at, history_id: historyId },
      },
      revertible: true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
