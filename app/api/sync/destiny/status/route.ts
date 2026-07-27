import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { getLatestSyncJob, getSyncJob } from "@/lib/sync-jobs";
import { DESTINY_SYNC_KIND } from "@/app/api/sync/destiny/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DestinyStatusResponse =
  | {
      jobId: string; status: "running" | "done" | "error"; total: number;
      inserted: number; updated: number; duplicates: number;
      no_campus_titles: string[]; unmapped_campuses: string[]; error?: string;
    }
  | { jobId: null };

/** GET /api/sync/destiny/status[?jobId=...] -- read-only progress check,
 *  independent of any single request staying open. Omit jobId to get the
 *  most recent Destiny sync job, so the Upload tab can notice "a sync was
 *  still running" after a page reload or a closed tab and resume watching
 *  it instead of losing track. Admin-only. */
export async function GET(req: Request) {
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmailFromRequest(req));
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can view this." }, { status: 403 });
  }

  const jobId = new URL(req.url).searchParams.get("jobId");
  const job = jobId ? await getSyncJob(db, jobId) : await getLatestSyncJob(db, DESTINY_SYNC_KIND);
  if (!job) {
    return NextResponse.json({ jobId: null } satisfies DestinyStatusResponse);
  }

  return NextResponse.json({
    jobId: job.id, status: job.status, total: job.total,
    inserted: job.inserted, updated: job.updated, duplicates: job.duplicates,
    no_campus_titles: job.no_campus_titles ?? [], unmapped_campuses: job.unmapped_campuses ?? [],
    error: job.error ?? undefined,
  } satisfies DestinyStatusResponse);
}
