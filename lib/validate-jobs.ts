/**
 * System-wide Validate Matches CSV: one uploaded file, covering every
 * program it mentions (via the CSV's own Program column -- see
 * parseValidationRows/programBibliographyCsv), checked and applied across
 * all of them instead of one program at a time. Reuses the sync_jobs/
 * sync_job_items pair from lib/sync-jobs.ts (see 47_validate_jobs_payload.sql
 * for why a second, differently-shaped job kind shares that table rather
 * than getting its own).
 *
 * Unlike a Destiny sync -- whose full set of writes is known up front --
 * this job doesn't know how many locks/removals it'll end up doing until
 * every program has been checked, and checking one program can itself
 * involve a fair number of Supabase round trips. So sync_job_items here
 * holds a MIX of two op kinds that get queued and drained by the same
 * loop: a "scan_program" op (one per program in the file) that, when
 * processed, itself queues new "lock"/"remove" ops for whatever that
 * program's check found -- so the queue only ever shrinks once every
 * program has been scanned and every resulting op applied. There's no
 * separate "phase" to track explicitly: while scan_program items remain,
 * new lock/remove work keeps appearing; once they're gone, the queue can
 * only shrink until it's empty and the job is done.
 */
import type { serviceClient } from "./supabase";
import { randomUUID } from "crypto";
import type { ValidationRow } from "./parsers";
import { buildProgramValidationPreview, type MatchPreviewRow } from "./validate-matches";

const ITEM_INSERT_BATCH = 500;
const ITEM_FETCH_BATCH = 200;
// Capped so the job row itself (payload jsonb) stays a sane, constant
// size no matter how big the uploaded file or how many programs it
// covers -- this is only ever used to render a representative sample in
// the UI, not to drive the actual lock/remove work (that's the queued ops).
const SAMPLE_CAP = 30;

export type ValidateSampleRow = { program: string; course: string; title: string };

export type ValidatePayload = {
  programsTotal: number;
  programsScanned: number;
  unknownPrograms: string[];
  applyTotal: number;
  applyDone: number;
  locked: number;
  removed: number;
  lockedSkippedCount: number;
  unresolvedCount: number;
  nextSeq: number;
  sample: {
    confirmed: ValidateSampleRow[];
    toRemove: ValidateSampleRow[];
    lockedSkipped: ValidateSampleRow[];
    unresolved: ValidateSampleRow[];
  };
};

type ScanOp = { type: "scan_program"; program_id: number; program_name: string; courseRows: ValidationRow[]; journalRows: ValidationRow[] };
type ApplyOp = { type: "lock" | "remove"; subject_id: number; title_id: number };
type ValidateOp = ScanOp | ApplyOp;

export type ValidateJobRow = {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  payload: ValidatePayload;
};

export const VALIDATE_JOB_KIND = "validate_matches";

function emptyPayload(programsTotal: number): ValidatePayload {
  return {
    programsTotal, programsScanned: 0, unknownPrograms: [],
    applyTotal: 0, applyDone: 0, locked: 0, removed: 0,
    lockedSkippedCount: 0, unresolvedCount: 0, nextSeq: programsTotal,
    sample: { confirmed: [], toRemove: [], lockedSkipped: [], unresolved: [] },
  };
}

function pushSample(list: ValidateSampleRow[], row: ValidateSampleRow) {
  if (list.length < SAMPLE_CAP) list.push(row);
}

/** Groups already-parsed CSV rows by their Program column, resolves each
 *  name to a program_id (case-insensitive exact match against the
 *  programs table -- combined-programs exports label a shared journal
 *  "Program A + Program B", so that literal string is split back apart
 *  first), and creates the job with one scan_program item per resolved
 *  program. A row whose Program value doesn't resolve (blank, a typo, or
 *  an export from before the Program column existed) is reported in
 *  unknownPrograms instead of silently dropped. */
export async function createValidateJob(
  db: ReturnType<typeof serviceClient>,
  rows: ValidationRow[],
  createdBy: string,
): Promise<{ jobId: string; programsTotal: number; unknownPrograms: string[] }> {
  const { data: programRows, error } = await db.from("programs").select("id, name");
  if (error) throw error;
  const byName = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.name.trim().toLowerCase(), p.id]));

  const byProgramId = new Map<number, { name: string; courseRows: ValidationRow[]; journalRows: ValidationRow[] }>();
  const unknownPrograms = new Set<string>();

  for (const r of rows) {
    const names = r.program.split("+").map((s) => s.trim()).filter(Boolean);
    const resolved = names.length ? names : [""];
    let matchedAny = false;
    for (const name of resolved) {
      const pid = byName.get(name.toLowerCase());
      if (pid == null) continue;
      matchedAny = true;
      if (!byProgramId.has(pid)) byProgramId.set(pid, { name, courseRows: [], journalRows: [] });
      const bucket = byProgramId.get(pid)!;
      if (r.course_code) bucket.courseRows.push(r);
      else bucket.journalRows.push(r);
    }
    if (!matchedAny) unknownPrograms.add(r.program || "(blank)");
  }

  const programEntries = Array.from(byProgramId.entries());
  const jobId = randomUUID();
  const payload = emptyPayload(programEntries.length);
  payload.unknownPrograms = Array.from(unknownPrograms);

  const { error: jobErr } = await db.from("sync_jobs").insert({
    id: jobId, kind: VALIDATE_JOB_KIND, status: "running",
    created_by: createdBy, payload,
  });
  if (jobErr) throw jobErr;

  const items: { job_id: string; seq: number; op: ScanOp }[] = programEntries.map(([program_id, v], i) => ({
    job_id: jobId, seq: i,
    op: { type: "scan_program", program_id, program_name: v.name, courseRows: v.courseRows, journalRows: v.journalRows },
  }));
  for (let i = 0; i < items.length; i += ITEM_INSERT_BATCH) {
    const { error: itemErr } = await db.from("sync_job_items").insert(items.slice(i, i + ITEM_INSERT_BATCH));
    if (itemErr) throw itemErr;
  }

  return { jobId, programsTotal: programEntries.length, unknownPrograms: payload.unknownPrograms };
}

export async function getValidateJob(db: ReturnType<typeof serviceClient>, jobId: string): Promise<ValidateJobRow | null> {
  const { data, error } = await db.from("sync_jobs").select("*").eq("id", jobId).eq("kind", VALIDATE_JOB_KIND).maybeSingle();
  if (error) throw error;
  return data as ValidateJobRow | null;
}

const toSample = (programName: string, r: MatchPreviewRow): ValidateSampleRow =>
  ({ program: programName, course: r.course_code || r.course_title, title: r.title });

export type ValidateChunkResult = { done: boolean; payload: ValidatePayload };

/** Works through as much of a job's queue as fits in budgetMs -- a
 *  scan_program item checks that program's rows against its current
 *  matches and queues a lock/remove op per result; a lock/remove item
 *  performs that one write. Safe to call again with the same jobId. */
export async function processValidateJobChunk(
  db: ReturnType<typeof serviceClient>,
  job: ValidateJobRow,
  budgetMs: number,
): Promise<ValidateChunkResult> {
  const deadline = Date.now() + budgetMs;
  const payload: ValidatePayload = { ...job.payload };

  const { count: initialCount, error: countErr } = await db.from("sync_job_items")
    .select("id", { count: "exact", head: true }).eq("job_id", job.id);
  if (countErr) throw countErr;
  let remaining = initialCount ?? 0;

  while (remaining > 0 && Date.now() < deadline) {
    const { data, error } = await db.from("sync_job_items")
      .select("id, op").eq("job_id", job.id).order("seq", { ascending: true }).limit(ITEM_FETCH_BATCH);
    if (error) throw error;
    const items = (data ?? []) as { id: number; op: ValidateOp }[];
    if (!items.length) { remaining = 0; break; }

    const newItems: { job_id: string; seq: number; op: ApplyOp }[] = [];

    for (const item of items) {
      const op = item.op;
      if (op.type === "scan_program") {
        const preview = await buildProgramValidationPreview(db, op.program_id, op.courseRows, op.journalRows);
        payload.programsScanned++;
        for (const r of preview.confirmed) {
          newItems.push({ job_id: job.id, seq: payload.nextSeq++, op: { type: "lock", subject_id: r.subject_id, title_id: r.title_id } });
          pushSample(payload.sample.confirmed, toSample(op.program_name, r));
        }
        for (const r of preview.toRemove) {
          newItems.push({ job_id: job.id, seq: payload.nextSeq++, op: { type: "remove", subject_id: r.subject_id, title_id: r.title_id } });
          pushSample(payload.sample.toRemove, toSample(op.program_name, r));
        }
        payload.applyTotal += preview.confirmed.length + preview.toRemove.length;
        payload.lockedSkippedCount += preview.lockedSkipped.length;
        for (const r of preview.lockedSkipped) pushSample(payload.sample.lockedSkipped, toSample(op.program_name, r));
        payload.unresolvedCount += preview.unresolvedRows.length;
        for (const r of preview.unresolvedRows) pushSample(payload.sample.unresolved, { program: op.program_name, course: r.course_code, title: r.title });
      } else if (op.type === "lock") {
        const { error: lockErr } = await db.from("assignments").update({ manual: 1 })
          .eq("subject_id", op.subject_id).eq("title_id", op.title_id);
        if (lockErr) throw lockErr;
        payload.locked++;
        payload.applyDone++;
      } else {
        const { error: rmErr } = await db.from("assignments").delete()
          .eq("subject_id", op.subject_id).eq("title_id", op.title_id).eq("manual", 0);
        if (rmErr) throw rmErr;
        payload.removed++;
        payload.applyDone++;
      }
    }

    if (newItems.length) {
      for (let i = 0; i < newItems.length; i += ITEM_INSERT_BATCH) {
        const { error: insErr } = await db.from("sync_job_items").insert(newItems.slice(i, i + ITEM_INSERT_BATCH));
        if (insErr) throw insErr;
      }
    }
    const ids = items.map((i) => i.id);
    const { error: delErr } = await db.from("sync_job_items").delete().in("id", ids);
    if (delErr) throw delErr;

    remaining = remaining - items.length + newItems.length;
  }

  const done = remaining <= 0;
  const { error: updErr } = await db.from("sync_jobs").update({
    payload, status: done ? "done" : "running", updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (updErr) throw updErr;

  return { done, payload };
}
