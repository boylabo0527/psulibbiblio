import { NextResponse } from "next/server";
import { RESOURCE_BY_ID } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";
import type { TitleRow } from "@/lib/types";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { planIngestOps } from "@/lib/ingest-titles";
import { destinyEnabled, fetchDestinyPrintedCatalog, mapSublocationToCampus } from "@/lib/destiny";
import { createSyncJob } from "@/lib/sync-jobs";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const DESTINY_SYNC_KIND = "destiny_printed_books";

export type DestinyStartResponse =
  | { jobId: string; total: number }
  | { jobId: null; total: 0 } // nothing to sync (empty catalog)
  | { error: string };

/** POST /api/sync/destiny -- starts a Destiny printed-book sync. Fetches
 *  the catalog and works out exactly what needs inserting/updating (see
 *  planIngestOps in lib/ingest-titles.ts), then persists that as a
 *  sync_jobs row rather than writing it all right here: a catalog with
 *  tens of thousands of rows can easily take longer to write than a
 *  single Vercel function invocation is allowed to run on the Hobby
 *  (free) plan, so the actual writes happen across several short
 *  /api/sync/destiny/continue calls instead (see that route). Admin-only,
 *  since it uses org-wide database credentials rather than a per-tab
 *  permission.
 *
 *  Note: the planning step above still does its dedup lookups against
 *  Supabase in one shot here. That's held up fine against catalogs in the
 *  tens of thousands of rows in practice, but a MUCH larger existing
 *  catalog could in principle make even planning too slow for one
 *  request -- if that ever happens, planning would need the same
 *  chunk-and-resume treatment applyIngestOps already gets. Not built
 *  proactively since it hasn't been needed. */
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

  const batchId = randomUUID();
  try {
    const destinyRows = await fetchDestinyPrintedCatalog();

    // Destiny's "sublocation" is finer-grained than this app's "campus"
    // (some sublocations are library sections within ONE campus, others
    // are each their own separate campus) -- mapSublocationToCampus
    // resolves that down first. If the RESULT still doesn't match a
    // campus this app already knows about (Campus Validation's list),
    // reports scoped by campus (Procurement, Dashboard breakdowns) won't
    // recognize it. Still synced, but flagged (by the original
    // sublocation string, so it's clear which Destiny value needs
    // attention) rather than silently going unnoticed.
    const { data: knownCampuses } = await db.from("campuses").select("name");
    const knownNames = new Set((knownCampuses ?? []).map((c) => c.name));
    const unmapped = new Set<string>();

    const records: TitleRow[] = destinyRows
      .filter((r) => (r.title ?? "").trim())
      .map((r) => {
        const sublocation = (r.sublocation ?? "").trim();
        const campus = sublocation ? mapSublocationToCampus(sublocation) : "";
        if (campus && !knownNames.has(campus)) unmapped.add(sublocation);
        return {
          title: r.title.trim(),
          author: (r.author ?? "").trim(),
          publisher: (r.publisher ?? "").trim(),
          year: r.year != null ? String(r.year) : "",
          call_no: (r.call_no ?? "").trim(),
          barcode: (r.barcode ?? "").trim(),
          campus,
          copies: r.copies ?? 1,
        };
      });

    if (!records.length) {
      await logActivity(db, {
        userEmail, action: "sync_destiny",
        summary: "Destiny sync: nothing to sync (0 rows fetched)",
      });
      return NextResponse.json({ jobId: null, total: 0 } satisfies DestinyStartResponse);
    }

    const rt = RESOURCE_BY_ID.book_printed;
    const plan = await planIngestOps(db, rt, records, batchId, "");

    const jobId = await createSyncJob(db, {
      kind: DESTINY_SYNC_KIND,
      ops: plan.ops,
      duplicates: plan.duplicates,
      noCampusTitles: plan.noCampusTitles,
      unmappedCampuses: Array.from(unmapped),
      batchId,
      createdBy: userEmail,
    });

    await logActivity(db, {
      userEmail, action: "sync_destiny",
      summary: `Destiny sync started: ${plan.ops.length.toLocaleString()} row(s) queued (${records.length.toLocaleString()} fetched, ${(plan.duplicates ?? 0).toLocaleString()} already up to date)`,
      detail: { jobId, total: plan.ops.length, fetched: records.length },
      batchId,
    });

    return NextResponse.json({ jobId, total: plan.ops.length } satisfies DestinyStartResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity(db, {
      userEmail, action: "sync_destiny",
      summary: `Destiny sync FAILED to start: ${message}`,
      detail: { error: message },
    });
    return NextResponse.json({ error: message } satisfies DestinyStartResponse, { status: 500 });
  }
}
