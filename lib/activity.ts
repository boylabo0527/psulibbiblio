import type { serviceClient } from "./supabase";

export type ActivityAction =
  | "upload_titles" | "upload_subjects"
  | "match_run"
  | "bulk_delete"
  | "program_create" | "program_rename" | "program_delete" | "program_merge" | "program_cost_estimate"
  | "subject_create" | "subject_edit" | "subject_lock" | "subject_unlock" | "subject_merge"
  | "title_merge"
  | "assignment_add" | "assignment_remove";

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
