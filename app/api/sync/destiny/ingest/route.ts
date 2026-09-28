import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import { startDestinySyncJob, type DestinyCatalogRow } from "@/lib/destiny";
import { errorMessage } from "@/lib/errors";
import type { DestinyStartResponse } from "@/app/api/sync/destiny/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUSH_USER = "destiny-push (script)";

/** POST /api/sync/destiny/ingest { rows: DestinyCatalogRow[] } -- the
 *  machine-to-machine counterpart to POST /api/sync/destiny, for when
 *  Vercel can't reach Destiny's SQL Server directly (it's on a campus
 *  network that can't -- or shouldn't -- open its database server's
 *  firewall to Vercel's non-static outbound IPs). A script running
 *  *inside* that network queries Destiny itself (see
 *  scripts/destiny-push.mjs) and POSTs the resulting rows here instead
 *  of this app pulling them; Destiny's SQL Server then never needs to
 *  accept a connection from the internet at all, only the script needs
 *  outbound HTTPS access to this app.
 *
 *  Authenticated via DESTINY_INGEST_SECRET, not a signed-in Supabase
 *  admin session -- there's no browser on the machine running the push
 *  script. See the bypass for this path in middleware.ts (it skips the
 *  normal Supabase-session check so this can run its own check instead,
 *  same pattern as /api/cron/*). Set DESTINY_INGEST_SECRET in Vercel's
 *  project env vars (any random string; `openssl rand -hex 32` works)
 *  and configure the push script with the same value.
 *
 *  Shares its actual sync logic with the pull-based route via
 *  startDestinySyncJob in lib/destiny.ts, so the two entry points can
 *  never process a row differently. */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.DESTINY_INGEST_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { rows?: DestinyCatalogRow[] } | null;
  const rows = body?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "Expected a JSON body of the form { rows: [...] }." }, { status: 400 });
  }

  const db = serviceClient();
  try {
    const plan = await startDestinySyncJob(db, rows, PUSH_USER);

    if (!plan.jobId) {
      await logActivity(db, {
        userEmail: PUSH_USER, action: "sync_destiny",
        summary: "Destiny sync (pushed): nothing to sync (0 rows received)",
      });
      return NextResponse.json({ jobId: null, total: 0 } satisfies DestinyStartResponse);
    }

    await logActivity(db, {
      userEmail: PUSH_USER, action: "sync_destiny",
      summary: `Destiny sync (pushed) started: ${plan.total.toLocaleString()} row(s) queued`
        + ` (${plan.fetched.toLocaleString()} received -- ${plan.journals.toLocaleString()} as printed journals, `
        + `${plan.books.toLocaleString()} as printed books -- ${plan.duplicates.toLocaleString()} already up to date)`,
      detail: { jobId: plan.jobId, total: plan.total, fetched: plan.fetched, journals: plan.journals, books: plan.books },
      batchId: plan.batchId,
    });

    return NextResponse.json({ jobId: plan.jobId, total: plan.total } satisfies DestinyStartResponse);
  } catch (err) {
    const message = errorMessage(err);
    await logActivity(db, {
      userEmail: PUSH_USER, action: "sync_destiny",
      summary: `Destiny sync (pushed) FAILED to start: ${message}`,
      detail: { error: message },
    });
    return NextResponse.json({ error: message } satisfies DestinyStartResponse, { status: 500 });
  }
}
