import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { OVERDUE_DAYS } from "@/lib/pr-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cron/pr-reminders -- emails whoever submitted a Purchase
 *  Request that's been sitting in its current office longer than
 *  Monitoring's overdue threshold, so a stuck PR gets noticed without
 *  someone having to remember to check Monitoring. Re-reminds every
 *  OVERDUE_DAYS again (via last_reminder_sent_at) rather than daily, once
 *  the cron (see vercel.json) has already sent one.
 *
 *  Authenticated via CRON_SECRET, same pattern as /api/cron/keepalive --
 *  no signed-in user to check permissions against on a cron trigger.
 *  Sending is best-effort: if RESEND_API_KEY isn't set, this still runs
 *  and reports what it *would* have sent (see lib/email.ts), so the
 *  overdue-detection logic can be verified/tested before email is wired
 *  up for real. */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = serviceClient();
    const { data: prs, error } = await db.from("purchase_requests")
      .select("id, pr_no, submitted_by, current_step_seq, step_entered_at, last_reminder_sent_at")
      .eq("status", "in_progress")
      .not("step_entered_at", "is", null);
    if (error) throw error;

    const { data: steps } = await db.from("pr_workflow_steps").select("seq, office_name");
    const officeBySeq = new Map((steps ?? []).map((s) => [s.seq, s.office_name]));

    const now = Date.now();
    const overdueMs = OVERDUE_DAYS * 86400000;
    const reminderCooldownMs = OVERDUE_DAYS * 86400000;

    const results: { pr_no: string; sent: boolean; reason?: string }[] = [];
    for (const pr of prs ?? []) {
      const enteredAt = new Date(pr.step_entered_at as string).getTime();
      const daysInStep = Math.floor((now - enteredAt) / 86400000);
      if (now - enteredAt < overdueMs) continue;
      if (pr.last_reminder_sent_at && now - new Date(pr.last_reminder_sent_at).getTime() < reminderCooldownMs) continue;
      if (!pr.submitted_by) continue;

      const officeName = pr.current_step_seq != null ? officeBySeq.get(pr.current_step_seq) ?? "its current office" : "its current office";
      const result = await sendEmail({
        to: pr.submitted_by,
        subject: `Purchase Request ${pr.pr_no || "(draft)"} has been in ${officeName} for ${daysInStep} days`,
        html: `<p>Purchase Request <strong>${pr.pr_no || "(draft)"}</strong> has been sitting in <strong>${officeName}</strong>
          for ${daysInStep} days, past the ${OVERDUE_DAYS}-day threshold. You may want to follow up.</p>
          <p>Check its status in Monitoring.</p>`,
      });
      results.push({ pr_no: pr.pr_no || "(draft)", sent: result.sent, reason: result.reason });

      if (result.sent) {
        await db.from("purchase_requests").update({ last_reminder_sent_at: new Date().toISOString() }).eq("id", pr.id);
        await logActivity(db, {
          action: "pr_overdue_reminder_sent",
          summary: `Overdue reminder sent to ${pr.submitted_by} for purchase request ${pr.pr_no || "(draft)"} (${daysInStep} days in ${officeName})`,
          detail: { purchase_request_id: pr.id, days_in_step: daysInStep, office: officeName },
        });
      }
    }

    return NextResponse.json({ ok: true, checked: (prs ?? []).length, reminders: results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
