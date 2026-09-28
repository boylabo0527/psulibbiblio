import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import { getSyncJob, markSyncJobError, processSyncJobChunk } from "@/lib/sync-jobs";
import { errorMessage } from "@/lib/errors";
import type { DestinyContinueResponse } from "@/app/api/sync/destiny/continue/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUSH_USER = "destiny-push (script)";

// Same reasoning as /api/sync/destiny/continue's own BUDGET_MS -- kept
// short and conservative so one call finishes with room to spare
// regardless of the account's real enforced function timeout. The push
// script just calls this again and again until `done: true`, same as the
// browser-driven Upload tab does for the pull-based sync.
const BUDGET_MS = 8_000;

/** POST /api/sync/destiny/ingest/continue { jobId } -- secret-authenticated
 *  counterpart to /api/sync/destiny/continue, for the push script (see
 *  scripts/destiny-push.mjs) to drive a job it started via
 *  /api/sync/destiny/ingest through to completion. Identical chunked-
 *  processing mechanics to the browser-driven route -- just gated by
 *  DESTINY_INGEST_SECRET instead of a signed-in admin session, since the
 *  push script has no browser session to carry. */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.DESTINY_INGEST_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { jobId?: string };
  const jobId = body.jobId;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const db = serviceClient();
  const job = await getSyncJob(db, jobId);
  if (!job) {
    return NextResponse.json({ error: "Sync job not found." }, { status: 404 });
  }

  const noCampusTitles = (job.no_campus_titles ?? []) as string[];
  const unmappedCampuses = (job.unmapped_campuses ?? []) as string[];

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
        userEmail: PUSH_USER, action: "sync_destiny",
        summary: `Synced printed books from Destiny (pushed): ${result.inserted.toLocaleString()} new, ${result.updated.toLocaleString()} updated${job.duplicates ? `, ${job.duplicates.toLocaleString()} duplicate${job.duplicates === 1 ? "" : "s"} skipped` : ""}${unmappedCampuses.length ? ` -- ${unmappedCampuses.length} unrecognized campus name(s): ${unmappedCampuses.join(", ")}` : ""}${noCampusTitles.length ? ` -- ${noCampusTitles.length} title(s) had no campus at all and were filed under "Main Campus" pending correction` : ""}`,
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
      userEmail: PUSH_USER, action: "sync_destiny",
      summary: `Destiny sync (pushed) FAILED: ${message}`,
      detail: { jobId, error: message },
    });
    return NextResponse.json({ error: message } satisfies DestinyContinueResponse, { status: 500 });
  }
}
