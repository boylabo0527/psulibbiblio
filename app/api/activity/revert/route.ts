import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest, type ActivityAction } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LogDetail = Record<string, unknown>;

/** POST /api/activity/revert — undo a revertible action, dispatching on
 *  what kind of action it was:
 *  - upload_subjects/upload_titles: delete exactly the rows that batch
 *    inserted (identified by batch_id), plus any assignments referencing
 *    them -- the original, upload-only revert.
 *  - purchase_request/purchase_order generate: delete the row that
 *    generating it created.
 *  - .../edit, .../cancel, pr_advance: restore the row (and, for PR
 *    workflow moves, the pr_step_history bookkeeping) to the `before`
 *    snapshot captured in activity_log.detail at the time of the action.
 *  Only revertible, not-yet-reverted log entries can be reverted, and only
 *  once -- reverting an edit doesn't know about any *later* edit, so it's
 *  a best-effort restore to that snapshot, not a full undo stack. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["activity"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to revert actions." }, { status: 403 });
    }
    const body = await req.json() as { activity_id?: number };
    const activityId = body.activity_id;
    if (!Number.isFinite(activityId)) {
      return NextResponse.json({ error: "activity_id is required" }, { status: 400 });
    }

    const { data: log, error: logErr } = await db.from("activity_log")
      .select("*").eq("id", activityId as number).maybeSingle();
    if (logErr) throw logErr;
    if (!log) return NextResponse.json({ error: "Activity entry not found" }, { status: 404 });
    if (!log.revertible) return NextResponse.json({ error: "This action can't be reverted" }, { status: 400 });
    if (log.reverted_at) return NextResponse.json({ error: "Already reverted" }, { status: 400 });

    const detail = (log.detail ?? {}) as LogDetail;
    let resultSummary: string;

    switch (log.action as ActivityAction) {
      case "upload_subjects":
      case "upload_titles": {
        if (!log.batch_id) return NextResponse.json({ error: "No batch to revert" }, { status: 400 });
        const table = log.action === "upload_subjects" ? "subjects" : "titles";
        const idCol = table === "subjects" ? "subject_id" : "title_id";

        const { data: rows, error: rowsErr } = await db.from(table).select("id").eq("batch_id", log.batch_id);
        if (rowsErr) throw rowsErr;
        const ids = (rows ?? []).map((r: { id: number }) => r.id);

        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const { error } = await db.from("assignments").delete().in(idCol, slice);
          if (error) throw error;
        }
        for (let i = 0; i < ids.length; i += CHUNK) {
          const slice = ids.slice(i, i + CHUNK);
          const { error } = await db.from(table).delete().in("id", slice);
          if (error) throw error;
        }
        resultSummary = `Reverted upload: deleted ${ids.length} ${table === "subjects" ? "subject" : "title"}${ids.length === 1 ? "" : "s"} from "${log.summary}"`;
        break;
      }

      case "purchase_request_generate": {
        const prId = detail.purchase_request_id as number | null;
        if (prId == null) return NextResponse.json({ error: "Nothing to revert." }, { status: 400 });
        await db.from("pr_step_history").delete().eq("purchase_request_id", prId);
        const { error } = await db.from("purchase_requests").delete().eq("id", prId);
        if (error) throw error;
        resultSummary = `Reverted: deleted the purchase request from "${log.summary}"`;
        break;
      }

      case "purchase_request_edit": {
        const prId = detail.purchase_request_id as number | null;
        const before = detail.before as Record<string, unknown> | undefined;
        if (prId == null || !before) return NextResponse.json({ error: "Nothing to revert." }, { status: 400 });
        const { error } = await db.from("purchase_requests").update(before).eq("id", prId);
        if (error) throw error;
        resultSummary = `Reverted edit: restored previous values for "${log.summary}"`;
        break;
      }

      case "purchase_request_cancel": {
        const prId = detail.purchase_request_id as number | null;
        const before = detail.before as { status: string; current_step_seq: number | null; step_entered_at: string | null; history_id: number | null } | undefined;
        if (prId == null || !before) return NextResponse.json({ error: "Nothing to revert." }, { status: 400 });
        const { error } = await db.from("purchase_requests").update({
          status: before.status, cancelled_at: null,
          current_step_seq: before.current_step_seq, step_entered_at: before.step_entered_at,
        }).eq("id", prId);
        if (error) throw error;
        if (before.history_id != null) {
          await db.from("pr_step_history").update({ left_at: null }).eq("id", before.history_id);
        }
        resultSummary = `Reverted cancellation: restored "${log.summary}"`;
        break;
      }

      case "pr_advance": {
        const prId = detail.purchase_request_id as number | null;
        const before = detail.before as { status: string; current_step_seq: number | null; step_entered_at: string | null; history_id: number | null; new_history_id?: number | null } | undefined;
        if (prId == null || !before) return NextResponse.json({ error: "Nothing to revert." }, { status: 400 });
        const { error } = await db.from("purchase_requests").update({
          status: before.status, current_step_seq: before.current_step_seq,
          step_entered_at: before.step_entered_at, completed_at: null,
        }).eq("id", prId);
        if (error) throw error;
        if (before.history_id != null) {
          await db.from("pr_step_history").update({ left_at: null }).eq("id", before.history_id);
        }
        if (before.new_history_id != null) {
          await db.from("pr_step_history").delete().eq("id", before.new_history_id);
        }
        resultSummary = `Reverted status change: restored previous office/status for "${log.summary}"`;
        break;
      }

      case "purchase_order_generate": {
        const poId = detail.purchase_order_id as number | null;
        if (poId == null) return NextResponse.json({ error: "Nothing to revert." }, { status: 400 });
        const { error } = await db.from("purchase_orders").delete().eq("id", poId);
        if (error) throw error;
        resultSummary = `Reverted: deleted the purchase order from "${log.summary}"`;
        break;
      }

      case "purchase_order_edit": {
        const poId = detail.purchase_order_id as number | null;
        const before = detail.before as Record<string, unknown> | undefined;
        if (poId == null || !before) return NextResponse.json({ error: "Nothing to revert." }, { status: 400 });
        const { error } = await db.from("purchase_orders").update(before).eq("id", poId);
        if (error) throw error;
        resultSummary = `Reverted edit: restored previous values for "${log.summary}"`;
        break;
      }

      case "purchase_order_cancel": {
        const poId = detail.purchase_order_id as number | null;
        const before = detail.before as { status: string } | undefined;
        if (poId == null || !before) return NextResponse.json({ error: "Nothing to revert." }, { status: 400 });
        const { error } = await db.from("purchase_orders").update({ status: before.status, cancelled_at: null }).eq("id", poId);
        if (error) throw error;
        resultSummary = `Reverted cancellation: restored "${log.summary}"`;
        break;
      }

      default:
        return NextResponse.json({ error: "This action type can't be reverted." }, { status: 400 });
    }

    await db.from("activity_log").update({ reverted_at: new Date().toISOString() }).eq("id", activityId as number);

    const userEmail = userEmailFromRequest(req);
    await logActivity(db, {
      userEmail, action: log.action as ActivityAction,
      summary: resultSummary,
      detail: { reverted_activity_id: activityId, ...(log.batch_id ? { batch_id: log.batch_id } : {}) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
