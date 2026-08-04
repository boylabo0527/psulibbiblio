import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { hostingerEnabled } from "@/lib/hostinger-mysql";
import { getLatestSyncJob } from "@/lib/sync-jobs";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const jobKind = (format: string) => `hostinger_migrate_${format}`;

/** POST /api/admin/migrate-to-hostinger { format, dryRun }
 *
 *  dryRun: previews the count without starting anything.
 *
 *  Otherwise: starts a job moving titles of the given format that have
 *  never been assigned to any subject out of Supabase and into the
 *  library's Hostinger MySQL database (see lib/hostinger-mysql.ts), so
 *  they stay searchable from the Perlego Catalog tab instead of being
 *  deleted. The job itself is done in small batches by repeated calls to
 *  /continue (see that route) -- this just creates the job row (or hands
 *  back an already-running one of the same kind, so double-clicking
 *  Start, or a page reload landing here again, resumes instead of
 *  starting a second one) and returns its id so the browser can poll it.
 *
 *  Admin-only, since it uses org-wide database credentials and
 *  permanently removes rows from Supabase. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can run this." }, { status: 403 });
  }
  if (!hostingerEnabled()) {
    return NextResponse.json({
      error: "Hostinger migration isn't configured yet -- set HOSTINGER_DB_HOST, HOSTINGER_DB_NAME, HOSTINGER_DB_USER, and HOSTINGER_DB_PASSWORD in Vercel's project settings.",
    }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as { format?: string; dryRun?: boolean };
  const format = body.format || "ebook_paid";
  const kind = jobKind(format);

  try {
    const { data: countData, error: countErr } = await db.rpc("unmatched_titles_count", { p_format: format });
    if (countErr) throw countErr;
    const total = Number(countData ?? 0);

    if (body.dryRun) {
      return NextResponse.json({ total });
    }

    const existing = await getLatestSyncJob(db, kind);
    if (existing && existing.status === "running") {
      return NextResponse.json({ jobId: existing.id, total: existing.total, resumed: true });
    }

    const { randomUUID } = await import("crypto");
    const jobId = randomUUID();
    const { error: insErr } = await db.from("sync_jobs").insert({
      id: jobId, kind, status: "running", total, inserted: 0, created_by: userEmail,
    });
    if (insErr) throw insErr;

    return NextResponse.json({ jobId, total, resumed: false });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
