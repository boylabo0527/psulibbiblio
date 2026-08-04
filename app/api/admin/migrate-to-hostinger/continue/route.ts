import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { insertPerlegoTitles } from "@/lib/hostinger-mysql";
import { getSyncJob, markSyncJobError } from "@/lib/sync-jobs";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Same reasoning as the Destiny sync's /continue: keep each call's actual
// work small and let the client just call again, rather than trusting a
// longer maxDuration to actually be honored end-to-end.
const BATCH_SIZE = 1000;

type UnmatchedRow = {
  id: number; title: string; author: string; publisher: string;
  year: string; isbn: string; url: string; subjects: string; provider: string;
};

/** POST /api/admin/migrate-to-hostinger/continue { jobId } -- moves one
 *  bounded batch of unmatched titles (see the job's format, encoded in
 *  its kind as hostinger_migrate_<format>) into Hostinger MySQL and
 *  deletes them from Supabase, then updates the job row. The client
 *  calls this in a loop until `done: true`, exactly like the Destiny
 *  sync. Admin-only. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can run this." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { jobId?: string };
  const jobId = body.jobId;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await getSyncJob(db, jobId);
  if (!job) {
    return NextResponse.json({ error: "Migration job not found." }, { status: 404 });
  }

  if (job.status !== "running") {
    return NextResponse.json({ done: job.status === "done", total: job.total, inserted: job.inserted, migrated: 0 });
  }

  const format = job.kind.startsWith("hostinger_migrate_") ? job.kind.slice("hostinger_migrate_".length) : "ebook_paid";

  try {
    const { data: batch, error: batchErr } = await db.rpc("unmatched_titles_batch", {
      p_format: format, batch_size: BATCH_SIZE,
    });
    if (batchErr) throw batchErr;
    const rows = (batch ?? []) as UnmatchedRow[];

    if (rows.length === 0) {
      await db.from("sync_jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", jobId);
      await logActivity(db, {
        userEmail, action: "hostinger_migrate",
        summary: `Migrated unmatched ${format} titles to Hostinger MySQL (overflow storage), freeing Supabase space: ${job.inserted.toLocaleString()} title(s) moved`,
        detail: { format, jobId, migrated: job.inserted },
      });
      return NextResponse.json({ done: true, total: job.total, inserted: job.inserted, migrated: 0 });
    }

    await insertPerlegoTitles(rows.map((r) => ({
      source_id: r.id, title: r.title, author: r.author, publisher: r.publisher,
      year: r.year, isbn: r.isbn, url: r.url, subjects: r.subjects, provider: r.provider,
    })));

    const ids = rows.map((r) => r.id);
    const { error: delErr } = await db.from("titles").delete().in("id", ids);
    if (delErr) throw delErr;

    const inserted = job.inserted + rows.length;
    const done = rows.length < BATCH_SIZE;
    const { error: updErr } = await db.from("sync_jobs").update({
      inserted, status: done ? "done" : "running", updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    if (updErr) throw updErr;

    if (done) {
      await logActivity(db, {
        userEmail, action: "hostinger_migrate",
        summary: `Migrated unmatched ${format} titles to Hostinger MySQL (overflow storage), freeing Supabase space: ${inserted.toLocaleString()} title(s) moved`,
        detail: { format, jobId, migrated: inserted },
      });
    }

    return NextResponse.json({ done, total: job.total, inserted, migrated: rows.length });
  } catch (err) {
    const message = errorMessage(err);
    await markSyncJobError(db, jobId, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
