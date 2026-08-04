import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/purchase-request/:id/advance -- moves a Purchase Request one
 *  step forward through the admin-configured office workflow (see
 *  /api/admin/pr-workflow). Three cases:
 *   - PR has no current_step_seq yet (created before a workflow existed,
 *     or before any steps were configured) -- enters the workflow at
 *     step 1.
 *   - PR is at some step that isn't the last -- closes that step's
 *     pr_step_history row and opens the next one.
 *   - PR is at the last configured step -- marks the PR "completed"
 *     instead of opening another step.
 *  Gated the same as Monitoring itself: admin, or explicit edit access to
 *  the monitoring tab -- advancing a PR through its approval chain is a
 *  Monitoring action, not a Purchase Request one (the person generating a
 *  PR isn't necessarily the one walking it through offices). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase request id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to advance purchase requests." }, { status: 403 });
    }

    const { data: pr, error: prErr } = await db.from("purchase_requests")
      .select("id, pr_no, current_step_seq, status").eq("id", id).maybeSingle();
    if (prErr) throw prErr;
    if (!pr) return NextResponse.json({ error: "Purchase request not found." }, { status: 404 });
    if (pr.status === "completed") {
      return NextResponse.json({ error: "This purchase request has already completed its workflow." }, { status: 400 });
    }

    const { data: steps, error: stepsErr } = await db.from("pr_workflow_steps").select("seq, office_name").order("seq");
    if (stepsErr) throw stepsErr;
    if (!steps || steps.length === 0) {
      return NextResponse.json({ error: "No PR workflow is configured yet -- add offices from Monitoring first." }, { status: 400 });
    }

    const now = new Date().toISOString();

    if (pr.current_step_seq == null) {
      const first = steps[0];
      await db.from("purchase_requests").update({ current_step_seq: first.seq, step_entered_at: now }).eq("id", id);
      await db.from("pr_step_history").insert({ purchase_request_id: id, seq: first.seq, office_name: first.office_name, entered_at: now, moved_by: email });
      await logActivity(db, {
        userEmail: email, action: "pr_advance",
        summary: `${pr.pr_no || "PR"} entered the workflow at "${first.office_name}"`,
        detail: { purchase_request_id: id, seq: first.seq },
      });
      return NextResponse.json({ ok: true, current_step_seq: first.seq, office_name: first.office_name, status: "in_progress" });
    }

    const idx = steps.findIndex((s) => s.seq === pr.current_step_seq);
    if (idx === -1) {
      return NextResponse.json({
        error: "This PR's current office no longer exists in the configured workflow (it may have been removed) -- an admin needs to reassign it.",
      }, { status: 409 });
    }

    await db.from("pr_step_history")
      .update({ left_at: now })
      .eq("purchase_request_id", id).eq("seq", pr.current_step_seq).is("left_at", null);

    if (idx === steps.length - 1) {
      await db.from("purchase_requests").update({ status: "completed", completed_at: now }).eq("id", id);
      await logActivity(db, {
        userEmail: email, action: "pr_advance",
        summary: `${pr.pr_no || "PR"} completed the workflow (last office was "${steps[idx].office_name}")`,
        detail: { purchase_request_id: id },
      });
      return NextResponse.json({ ok: true, current_step_seq: pr.current_step_seq, office_name: steps[idx].office_name, status: "completed" });
    }

    const next = steps[idx + 1];
    await db.from("purchase_requests").update({ current_step_seq: next.seq, step_entered_at: now }).eq("id", id);
    await db.from("pr_step_history").insert({ purchase_request_id: id, seq: next.seq, office_name: next.office_name, entered_at: now, moved_by: email });
    await logActivity(db, {
      userEmail: email, action: "pr_advance",
      summary: `${pr.pr_no || "PR"} moved from "${steps[idx].office_name}" to "${next.office_name}"`,
      detail: { purchase_request_id: id, from_seq: pr.current_step_seq, to_seq: next.seq },
    });
    return NextResponse.json({ ok: true, current_step_seq: next.seq, office_name: next.office_name, status: "in_progress" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
