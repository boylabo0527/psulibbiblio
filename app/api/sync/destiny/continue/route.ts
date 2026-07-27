import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { getSyncJob, markSyncJobError, processSyncJobChunk } from "@/lib/sync-jobs";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A 504 on this route in practice means the account's real enforced
// function timeout is well under the 60s maxDuration declared above (or
// there's a gateway/proxy in front of it with its own shorter cap) --
// declaring a longer maxDuration doesn't help if something else is
// cutting the request off first. Kept short and conservative so this
// finishes with room to spare even on a tightly-capped plan; the client
// (see DestinySyncCard) just calls this again and again regardless, so a
// smaller budget only means more calls, not a slower sync overall.
const BUDGET_MS = 8_000;

export type DestinyContinueResponse =
  | {
      done: boolean; total: number; remaining: number;
      inserted: number; updated: number; duplicates: number;
      no_campus_titles: string[]; unmapped_campuses: string[];
    }
  | { error: string };

/** POST /api/sync/destiny/continue { jobId } -- works through a bounded
 *  chunk of a Destiny sync job's queued writes (see lib/sync-jobs.ts) and
 *  returns current progress. The client calls this in a loop until
 *  `done: true` -- each individual call is time-boxed well under a
 *  serverless function's execution limit, so a sync with tens of
 *  thousands of rows finishes over several requests instead of failing
 *  outright on one that runs too long. Admin-only, matching the sync
 *  start endpoint. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can run a Destiny sync." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { jobId?: string };
  const jobId = body.jobId;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await getSyncJob(db, jobId);
  if (!job) {
    return NextResponse.json({ error: "Sync job not found." }, { status: 404 });
  }

  const noCampusTitles = (job.no_campus_titles ?? []) as string[];
  const unmappedCampuses = (job.unmapped_campuses ?? []) as string[];

  // Already finished (or failed) on a previous call -- just report that,
  // rather than reprocessing (there's nothing left in sync_job_items
  // anyway once a job is done).
  if (job.status !== "running") {
    return NextResponse.json({
      done: job.status === "done", total: job.total, remaining: 0,
      inserted: job.inserted, updated: job.updated, duplicates: job.duplicates,
      no_campus_titles: noCampusTitles, unmapped_campuses: unmappedCampuses,
    } satisfies DestinyContinueResponse);
  }

  try {
    const result = await processSyncJobChunk(db, job, BUDGET_MS);
    if (result.done) {
      await logActivity(db, {
        userEmail, action: "sync_destiny",
        summary: `Synced printed books from Destiny: ${result.inserted.toLocaleString()} new, ${result.updated.toLocaleString()} updated${job.duplicates ? `, ${job.duplicates.toLocaleString()} duplicate${job.duplicates === 1 ? "" : "s"} skipped` : ""}${unmappedCampuses.length ? ` -- ${unmappedCampuses.length} unrecognized campus name(s): ${unmappedCampuses.join(", ")}` : ""}${noCampusTitles.length ? ` -- ${noCampusTitles.length} title(s) had no campus at all and were filed under "Main Campus" pending correction` : ""}`,
        detail: {
          jobId, received: job.total, inserted: result.inserted, updated: result.updated,
          duplicates: job.duplicates, unmapped_campuses: unmappedCampuses, no_campus_titles: noCampusTitles,
        },
        batchId: job.batch_id ?? undefined, revertible: result.inserted > 0,
      });
    }
    return NextResponse.json({
      done: result.done, total: job.total, remaining: result.remaining,
      inserted: result.inserted, updated: result.updated, duplicates: job.duplicates,
      no_campus_titles: noCampusTitles, unmapped_campuses: unmappedCampuses,
    } satisfies DestinyContinueResponse);
  } catch (err) {
    const message = errorMessage(err);
    await markSyncJobError(db, jobId, message);
    await logActivity(db, {
      userEmail, action: "sync_destiny",
      summary: `Destiny sync FAILED: ${message}`,
      detail: { jobId, error: message },
    });
    return NextResponse.json({ error: message } satisfies DestinyContinueResponse, { status: 500 });
  }
}
