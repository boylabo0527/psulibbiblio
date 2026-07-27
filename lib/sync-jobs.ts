/**
 * Persistence for resumable background sync jobs (see supabase/migrations/
 * 17_sync_jobs.sql for the rationale and schema). A job is created once
 * with the full list of ops already worked out (see planIngestOps in
 * lib/ingest-titles.ts), then chipped away at by repeated, short
 * processSyncJobChunk() calls -- each one only needs to fit inside a
 * single Vercel function invocation, however many of them that takes.
 */
import type { serviceClient } from "./supabase";
import type { IngestOp } from "./ingest-titles";
import { randomUUID } from "crypto";

export type SyncJobRow = {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  total: number;
  inserted: number;
  updated: number;
  duplicates: number;
  no_campus_titles: string[];
  unmapped_campuses: string[];
  error: string | null;
  batch_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const ITEM_INSERT_BATCH = 500;

export async function createSyncJob(
  db: ReturnType<typeof serviceClient>,
  opts: {
    kind: string;
    ops: IngestOp[];
    duplicates?: number;
    noCampusTitles: string[];
    unmappedCampuses: string[];
    batchId: string;
    createdBy: string;
  },
): Promise<string> {
  const jobId = randomUUID();
  const { error } = await db.from("sync_jobs").insert({
    id: jobId,
    kind: opts.kind,
    status: "running",
    total: opts.ops.length,
    duplicates: opts.duplicates ?? 0,
    no_campus_titles: opts.noCampusTitles,
    unmapped_campuses: opts.unmappedCampuses,
    batch_id: opts.batchId,
    created_by: opts.createdBy,
  });
  if (error) throw error;

  for (let i = 0; i < opts.ops.length; i += ITEM_INSERT_BATCH) {
    const slice = opts.ops.slice(i, i + ITEM_INSERT_BATCH);
    const rows = slice.map((op, j) => ({ job_id: jobId, seq: i + j, op }));
    const { error: itemErr } = await db.from("sync_job_items").insert(rows);
    if (itemErr) throw itemErr;
  }

  return jobId;
}

export async function getSyncJob(db: ReturnType<typeof serviceClient>, jobId: string): Promise<SyncJobRow | null> {
  const { data, error } = await db.from("sync_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  return data as SyncJobRow | null;
}

export async function getLatestSyncJob(db: ReturnType<typeof serviceClient>, kind: string): Promise<SyncJobRow | null> {
  const { data, error } = await db.from("sync_jobs")
    .select("*").eq("kind", kind)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as SyncJobRow | null;
}

export async function markSyncJobError(db: ReturnType<typeof serviceClient>, jobId: string, message: string): Promise<void> {
  await db.from("sync_jobs").update({ status: "error", error: message, updated_at: new Date().toISOString() }).eq("id", jobId);
}

export type ChunkResult = { done: boolean; inserted: number; updated: number; remaining: number };

/** Works through as much of a job's queued ops as fits in budgetMs, then
 *  persists progress and returns. Safe to call again with the same jobId
 *  to keep going -- each call only ever looks at whatever's still left in
 *  sync_job_items, so there's no cursor to get out of sync. */
export async function processSyncJobChunk(
  db: ReturnType<typeof serviceClient>,
  job: SyncJobRow,
  budgetMs: number,
): Promise<ChunkResult> {
  const deadline = Date.now() + budgetMs;
  let insertedDelta = 0;
  let updatedDelta = 0;

  const { count: initialCount, error: countErr } = await db.from("sync_job_items")
    .select("id", { count: "exact", head: true }).eq("job_id", job.id);
  if (countErr) throw countErr;
  let remaining = initialCount ?? 0;

  while (remaining > 0 && Date.now() < deadline) {
    const { data, error } = await db.from("sync_job_items")
      .select("id, op").eq("job_id", job.id).order("seq", { ascending: true }).limit(500);
    if (error) throw error;
    const items = (data ?? []) as { id: number; op: IngestOp }[];
    if (!items.length) { remaining = 0; break; }

    const inserts = items
      .filter((i): i is { id: number; op: Extract<IngestOp, { kind: "insert" }> } => i.op.kind === "insert")
      .map((i) => i.op.row);
    const updates = items
      .filter((i): i is { id: number; op: Extract<IngestOp, { kind: "update" }> } => i.op.kind === "update")
      .map((i) => i.op);

    if (inserts.length) {
      const { error: insErr } = await db.from("titles").insert(inserts);
      if (insErr) throw insErr;
      insertedDelta += inserts.length;
    }
    if (updates.length) {
      const { error: updErr } = await db.from("titles").upsert(
        updates.map((u) => ({ id: u.id, copies: u.copies, barcodes: u.barcodes })),
      );
      if (updErr) throw updErr;
      updatedDelta += updates.length;
    }

    const ids = items.map((i) => i.id);
    const { error: delErr } = await db.from("sync_job_items").delete().in("id", ids);
    if (delErr) throw delErr;

    remaining -= items.length;
  }

  const done = remaining <= 0;
  const inserted = job.inserted + insertedDelta;
  const updated = job.updated + updatedDelta;
  const { error: jobUpdErr } = await db.from("sync_jobs").update({
    inserted, updated,
    status: done ? "done" : "running",
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (jobUpdErr) throw jobUpdErr;

  return { done, inserted, updated, remaining };
}
