import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { getLatestSyncJob, getSyncJob } from "@/lib/sync-jobs";
import { jobKind } from "@/app/api/admin/migrate-to-hostinger/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/migrate-to-hostinger/status[?jobId=...][?format=...] --
 *  read-only progress check, independent of any single /continue request
 *  staying open. Omit jobId to get the most recent migration job for the
 *  given format (defaults to ebook_paid), so the admin tool can notice "a
 *  migration was still running" after a page reload and resume watching
 *  it instead of losing track. Admin-only. */
export async function GET(req: Request) {
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmailFromRequest(req));
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can view this." }, { status: 403 });
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  const format = url.searchParams.get("format") || "ebook_paid";
  const job = jobId ? await getSyncJob(db, jobId) : await getLatestSyncJob(db, jobKind(format));
  if (!job) {
    return NextResponse.json({ jobId: null });
  }

  return NextResponse.json({
    jobId: job.id, status: job.status, total: job.total, inserted: job.inserted, error: job.error ?? undefined,
  });
}
