import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { ndjsonStream } from "@/lib/streaming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Item = { subject_id: number; title_id: number };

export type BulkLockEvent =
  | { phase: "locking"; done: number; total: number; updated: number }
  | { phase: "done"; updated: number }
  | { phase: "error"; error: string };

/** POST /api/match/lock/bulk -- lock (or unlock) several existing matches
 *  at once, across one or many courses in a single request. Body: {
 *  items: [{ subject_id, title_id }, ...], lock? }. Locking flips
 *  assignments.manual so a Match run never deletes/replaces that match,
 *  even though the course itself keeps getting re-matched for new books --
 *  same semantics as the single-title lock button and /api/match/override,
 *  just for many rows at once (e.g. every match a CSV validation upload
 *  confirmed, or a librarian's own multi-select in Programs & Export).
 *
 *  Streams progress (one course at a time, in order) as newline-delimited
 *  JSON so a large batch shows visible progress instead of one silent
 *  multi-second request. */
export async function POST(req: Request) {
  const db = serviceClient();
  const email = userEmailFromRequest(req);
  const perms = await getUserPermissions(db, email);
  if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
    return new Response(JSON.stringify({ error: "Your account doesn't have permission to change assignments." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({})) as { items?: Item[]; lock?: boolean };
  const lock = body.lock !== false;
  const items = (body.items ?? [])
    .filter((i) => Number.isFinite(Number(i.subject_id)) && Number.isFinite(Number(i.title_id)))
    .map((i) => ({ subject_id: Number(i.subject_id), title_id: Number(i.title_id) }));
  if (!items.length) {
    return new Response(JSON.stringify({ error: "No items given." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const bySubject = new Map<number, number[]>();
  for (const i of items) {
    if (!bySubject.has(i.subject_id)) bySubject.set(i.subject_id, []);
    bySubject.get(i.subject_id)!.push(i.title_id);
  }
  const subjectEntries = Array.from(bySubject.entries());

  const stream = ndjsonStream<BulkLockEvent>(async (send) => {
    let updated = 0;
    let done = 0;
    send({ phase: "locking", done, total: subjectEntries.length, updated });
    for (const [subjectId, titleIds] of subjectEntries) {
      const { data, error } = await db.from("assignments")
        .update({ manual: lock ? 1 : 0 })
        .eq("subject_id", subjectId).in("title_id", titleIds)
        .select("id");
      if (error) throw error;
      updated += data?.length ?? 0;
      done++;
      send({ phase: "locking", done, total: subjectEntries.length, updated });
    }

    await logActivity(db, {
      userEmail: email, action: "assignment_bulk_lock",
      summary: `${email || "Someone"} ${lock ? "locked" : "unlocked"} ${updated} title-course match${updated === 1 ? "" : "es"}`,
      detail: { updated, subjects: subjectEntries.length, lock },
    });
    send({ phase: "done", updated });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
