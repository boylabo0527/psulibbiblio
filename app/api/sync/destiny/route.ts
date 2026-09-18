import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { destinyEnabled, fetchDestinyPrintedCatalog, startDestinySyncJob } from "@/lib/destiny";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type DestinyStartResponse =
  | { jobId: string; total: number }
  | { jobId: null; total: 0 } // nothing to sync (empty catalog)
  | { error: string };

/** POST /api/sync/destiny -- starts a Destiny printed-book sync. Fetches
 *  the catalog and works out exactly what needs inserting/updating (see
 *  startDestinySyncJob in lib/destiny.ts), then persists that as a
 *  sync_jobs row rather than writing it all right here: a catalog with
 *  tens of thousands of rows can easily take longer to write than a
 *  single Vercel function invocation is allowed to run on the Hobby
 *  (free) plan, so the actual writes happen across several short
 *  /api/sync/destiny/continue calls instead (see that route). Admin-only,
 *  since it uses org-wide database credentials rather than a per-tab
 *  permission.
 *
 *  If Destiny's SQL Server can't accept an inbound connection from Vercel
 *  (e.g. it's not reachable from the internet, or its firewall can't be
 *  opened to Vercel's non-static IPs), see POST /api/sync/destiny/ingest
 *  instead -- same sync, just fed rows pushed in from a script running
 *  inside the Destiny network rather than pulled from here.
 *
 *  Note: the planning step still does its dedup lookups against Supabase
 *  in one shot here. That's held up fine against catalogs in the tens of
 *  thousands of rows in practice, but a MUCH larger existing catalog
 *  could in principle make even planning too slow for one request -- if
 *  that ever happens, planning would need the same chunk-and-resume
 *  treatment applyIngestOps already gets. Not built proactively since it
 *  hasn't been needed. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can run a Destiny sync." }, { status: 403 });
  }
  if (!destinyEnabled()) {
    return NextResponse.json({
      error: "Destiny sync isn't configured yet -- set DESTINY_DB_HOST, DESTINY_DB_NAME, DESTINY_DB_USER, and DESTINY_DB_PASSWORD in Vercel's project settings.",
    }, { status: 400 });
  }

  try {
    const destinyRows = await fetchDestinyPrintedCatalog();
    const plan = await startDestinySyncJob(db, destinyRows, userEmail);

    if (!plan.jobId) {
      await logActivity(db, {
        userEmail, action: "sync_destiny",
        summary: "Destiny sync: nothing to sync (0 rows fetched)",
      });
      return NextResponse.json({ jobId: null, total: 0 } satisfies DestinyStartResponse);
    }

    await logActivity(db, {
      userEmail, action: "sync_destiny",
      summary: `Destiny sync started: ${plan.total.toLocaleString()} row(s) queued`
        + ` (${plan.fetched.toLocaleString()} fetched -- ${plan.journals.toLocaleString()} as printed journals, `
        + `${plan.books.toLocaleString()} as printed books -- ${plan.duplicates.toLocaleString()} already up to date)`,
      detail: { jobId: plan.jobId, total: plan.total, fetched: plan.fetched, journals: plan.journals, books: plan.books },
      batchId: plan.batchId,
    });

    return NextResponse.json({ jobId: plan.jobId, total: plan.total } satisfies DestinyStartResponse);
  } catch (err) {
    const message = errorMessage(err);
    await logActivity(db, {
      userEmail, action: "sync_destiny",
      summary: `Destiny sync FAILED to start: ${message}`,
      detail: { error: message },
    });
    return NextResponse.json({ error: message } satisfies DestinyStartResponse, { status: 500 });
  }
}
