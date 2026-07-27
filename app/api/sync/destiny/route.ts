import { ndjsonStream } from "@/lib/streaming";
import { RESOURCE_BY_ID } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";
import type { TitleRow } from "@/lib/types";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { ingestTitleRecords } from "@/lib/ingest-titles";
import { destinyEnabled, fetchDestinyPrintedCatalog } from "@/lib/destiny";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type DestinySyncEvent =
  | { phase: "connecting" }
  | { phase: "parsed"; total: number }
  | { phase: "deduping"; existing: number }
  | { phase: "inserting"; inserted: number; skipped: number; total: number }
  | { phase: "done"; received: number; inserted: number; skipped: number; duplicates?: number; unmapped_campuses: string[] }
  | { phase: "error"; error: string };

/** POST /api/sync/destiny -- pulls the printed-book catalog directly from
 *  Destiny's SQL Server and ingests it through the same dedup/accession
 *  logic as a manual printed-books upload (see lib/ingest-titles.ts).
 *  Admin-only: this uses org-wide database credentials, not something
 *  scoped per-tab permission. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin) {
    return new Response(JSON.stringify({ error: "Only an admin can run a Destiny sync." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  if (!destinyEnabled()) {
    return new Response(JSON.stringify({
      error: "Destiny sync isn't configured yet -- set DESTINY_DB_HOST, DESTINY_DB_NAME, DESTINY_DB_USER, and DESTINY_DB_PASSWORD in Vercel's project settings.",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const batchId = randomUUID();

  const stream = ndjsonStream<DestinySyncEvent>(async (send) => {
    try {
      send({ phase: "connecting" });
      const destinyRows = await fetchDestinyPrintedCatalog();

      // Campus names come from Destiny's own site/location field -- if one
      // doesn't match a campus this app already knows about (Campus
      // Validation's list), reports scoped by campus (Procurement,
      // Dashboard breakdowns) won't recognize it. Still synced, but
      // flagged so it can be fixed (rename the campus here to match, or
      // add it in Campus Validation) rather than silently going unnoticed.
      const { data: knownCampuses } = await db.from("campuses").select("name");
      const knownNames = new Set((knownCampuses ?? []).map((c) => c.name));
      const unmapped = new Set<string>();

      const records: TitleRow[] = destinyRows
        .filter((r) => (r.title ?? "").trim())
        .map((r) => {
          const campus = (r.campus ?? "").trim();
          if (campus && !knownNames.has(campus)) unmapped.add(campus);
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
      send({ phase: "parsed", total: records.length });
      if (!records.length) {
        send({ phase: "done", received: 0, inserted: 0, skipped: 0, unmapped_campuses: [] });
        return;
      }

      const rt = RESOURCE_BY_ID.book_printed;
      const result = await ingestTitleRecords(db, rt, records, batchId, send);
      send({ phase: "done", ...result, unmapped_campuses: Array.from(unmapped) });
      await logActivity(db, {
        userEmail, action: "sync_destiny",
        summary: `Synced printed books from Destiny: ${result.inserted} new, ${result.skipped} updated${result.duplicates != null ? `, ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped` : ""}${unmapped.size ? ` -- ${unmapped.size} unrecognized campus name(s): ${Array.from(unmapped).join(", ")}` : ""}`,
        detail: { ...result, unmapped_campuses: Array.from(unmapped) },
        batchId, revertible: result.inserted > 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logActivity(db, {
        userEmail, action: "sync_destiny",
        summary: `Destiny sync FAILED: ${message}`,
        detail: { error: message },
      });
      send({ phase: "error", error: message });
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
