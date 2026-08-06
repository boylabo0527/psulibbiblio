import type { serviceClient } from "./supabase";

export type ActivityAction =
  | "upload_titles" | "upload_subjects" | "sync_destiny"
  | "match_run"
  | "bulk_delete" | "hostinger_migrate"
  | "program_create" | "program_rename" | "program_delete" | "program_merge" | "program_cost_estimate" | "program_college_set"
  | "subject_create" | "subject_edit" | "subject_lock" | "subject_unlock" | "subject_merge"
  | "title_merge"
  | "assignment_add" | "assignment_remove"
  | "role_create" | "role_delete" | "role_permission_edit"
  | "user_role_assign" | "user_role_remove" | "user_campus_scope_edit"
  | "supplier_offer_submit" | "supplier_offer_decide"
  | "purchase_request_generate" | "purchase_request_edit" | "purchase_request_cancel" | "purchase_request_delete"
  | "pr_workflow_step_create" | "pr_workflow_step_edit" | "pr_workflow_step_delete"
  | "pr_advance" | "campus_budget_set" | "purchase_order_generate"
  | "purchase_order_edit" | "purchase_order_cancel" | "purchase_order_delete"
  | "canvassing_price_reverify" | "canvassing_link_subject"
  | "title_recommendation_submit" | "title_recommendation_status" | "title_recommendation_delete" | "title_recommendation_reassign" | "title_recommendation_bulk_upload"
  | "standard_title_bulk_upload" | "standard_title_delete"
  | "supplier_create" | "supplier_edit" | "supplier_delete"
  | "purchase_order_delivery_status"
  | "pr_overdue_reminder_sent"
  | "tor_generate";

/** Records one row in activity_log. Best-effort: a logging failure must
 *  never break the operation it's describing, so errors are swallowed
 *  (and reported to the server console) rather than thrown. */
export async function logActivity(
  db: ReturnType<typeof serviceClient>,
  opts: {
    userEmail?: string;
    action: ActivityAction;
    summary: string;
    detail?: Record<string, unknown>;
    batchId?: string;
    revertible?: boolean;
  },
): Promise<void> {
  try {
    const { error } = await db.from("activity_log").insert({
      user_email: opts.userEmail ?? "",
      action: opts.action,
      summary: opts.summary,
      detail: opts.detail ?? {},
      batch_id: opts.batchId ?? null,
      revertible: !!opts.revertible,
    });
    if (error) console.error("Failed to write activity_log:", error);
  } catch (err) {
    console.error("Failed to write activity_log:", err);
  }
}

/** Pulls the signed-in user's email out of the header middleware.ts sets
 *  after verifying their Supabase access token. */
export function userEmailFromRequest(req: Request): string {
  return req.headers.get("x-user-email") ?? "";
}
