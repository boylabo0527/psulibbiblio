import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isCampusInScope } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/purchase-request/:id/status -- sets which office a Purchase
 *  Request currently sits in, or marks it completed. This is a status
 *  record, not an approval action: the actual approving happens on paper
 *  across offices outside this app, so the office can be set to ANY
 *  configured step directly (including back to an earlier one, e.g. if it
 *  was returned) rather than only stepping forward one at a time.
 *  Cancelling is a separate, distinct endpoint (see /cancel) so it can't
 *  happen via the wrong dropdown option here.
 *  Body: { current_step_seq: number } or { status: "completed" }.
 *  Gated the same as the rest of Monitoring's PR actions. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase request id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to update purchase request status." }, { status: 403 });
    }

    const { data: pr, error: prErr } = await db.from("purchase_requests")
      .select("id, pr_no, current_step_seq, step_entered_at, status, campus_id").eq("id", id).maybeSingle();
    if (prErr) throw prErr;
    if (!pr) return NextResponse.json({ error: "Purchase request not found." }, { status: 404 });
    if (!isCampusInScope(perms, pr.campus_id)) {
      return NextResponse.json({ error: "This purchase request isn't in your assigned campus(es)." }, { status: 403 });
    }
    if (pr.status === "cancelled") {
      return NextResponse.json({ error: "This purchase request is cancelled -- generate a new one instead." }, { status: 400 });
    }

    const body = await req.json() as { current_step_seq?: number; status?: string };
    const now = new Date().toISOString();

    if (body.status === "completed") {
      let historyId: number | null = null;
      if (pr.current_step_seq != null) {
        const { data: histRows } = await db.from("pr_step_history")
          .update({ left_at: now })
          .eq("purchase_request_id", id).eq("seq", pr.current_step_seq).is("left_at", null)
          .select("id");
        historyId = histRows?.[0]?.id ?? null;
      }
      await db.from("purchase_requests").update({ status: "completed", completed_at: now }).eq("id", id);
      await logActivity(db, {
        userEmail: email, action: "pr_advance",
        summary: `${pr.pr_no || "PR"} marked completed`,
        detail: {
          purchase_request_id: id,
          before: { status: pr.status, current_step_seq: pr.current_step_seq, step_entered_at: pr.step_entered_at, history_id: historyId },
        },
        revertible: true,
      });
      return NextResponse.json({ ok: true, status: "completed" });
    }

    if (!Number.isFinite(body.current_step_seq)) {
      return NextResponse.json({ error: "current_step_seq or status is required" }, { status: 400 });
    }
    const { data: step } = await db.from("pr_workflow_steps").select("seq, office_name").eq("seq", body.current_step_seq as number).maybeSingle();
    if (!step) return NextResponse.json({ error: "That office isn't in the configured workflow." }, { status: 400 });

    let prevHistoryId: number | null = null;
    if (pr.current_step_seq != null) {
      const { data: histRows } = await db.from("pr_step_history")
        .update({ left_at: now })
        .eq("purchase_request_id", id).eq("seq", pr.current_step_seq).is("left_at", null)
        .select("id");
      prevHistoryId = histRows?.[0]?.id ?? null;
    }
    const { data: newHist } = await db.from("pr_step_history").insert({
      purchase_request_id: id, seq: step.seq, office_name: step.office_name, entered_at: now, moved_by: email,
    }).select("id").single();
    await db.from("purchase_requests").update({
      current_step_seq: step.seq, step_entered_at: now, status: "in_progress",
    }).eq("id", id);

    await logActivity(db, {
      userEmail: email, action: "pr_advance",
      summary: `${pr.pr_no || "PR"} status set to "${step.office_name}"`,
      detail: {
        purchase_request_id: id, seq: step.seq,
        before: { status: pr.status, current_step_seq: pr.current_step_seq, step_entered_at: pr.step_entered_at, history_id: prevHistoryId, new_history_id: newHist?.id ?? null },
      },
      revertible: true,
    });
    return NextResponse.json({ ok: true, current_step_seq: step.seq, office_name: step.office_name, status: "in_progress" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
