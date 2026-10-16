import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { logActivity } from "@/lib/activity";
import { getValidateJob, processValidateJobChunk, type ValidatePayload } from "@/lib/validate-jobs";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same rationale as /api/sync/destiny/continue's own budget: kept well
// under any plan's actual enforced function timeout, since the client
// just calls this again and again regardless -- a smaller budget only
// means more calls, not a slower job overall.
const BUDGET_MS = 8_000;

export type ValidateContinueResponse =
  | { done: boolean; error?: string; payload: ValidatePayload }
  | { error: string };

/** POST /api/validate-csv/continue { jobId } -- works through a bounded
 *  chunk of a system-wide validate job's queue (see lib/validate-jobs.ts)
 *  and returns current progress. Call in a loop until `done: true`. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
    return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { jobId?: string };
  const jobId = body.jobId;
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const job = await getValidateJob(db, jobId);
  if (!job) return NextResponse.json({ error: "Validate job not found." }, { status: 404 });

  if (job.status !== "running") {
    return NextResponse.json({ done: job.status === "done", error: job.error ?? undefined, payload: job.payload } satisfies ValidateContinueResponse);
  }

  try {
    const result = await processValidateJobChunk(db, job, BUDGET_MS);
    if (result.done) {
      const p = result.payload;
      await logActivity(db, {
        userEmail, action: "assignment_validate_csv",
        summary: `${userEmail || "Someone"} ran a system-wide Validate Matches CSV across ${p.programsTotal} program(s): ${p.locked} match(es) locked, ${p.removed} removed`
          + (p.unknownPrograms.length ? `, ${p.unknownPrograms.length} unrecognized program name(s) in the file` : ""),
        detail: p,
      });
    }
    return NextResponse.json({ done: result.done, payload: result.payload } satisfies ValidateContinueResponse);
  } catch (err) {
    const message = errorMessage(err);
    await db.from("sync_jobs").update({ status: "error", error: message, updated_at: new Date().toISOString() }).eq("id", jobId);
    return NextResponse.json({ error: message } satisfies ValidateContinueResponse, { status: 500 });
  }
}
