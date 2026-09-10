import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { ndjsonStream } from "@/lib/streaming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Removal = { subject_id: number; title_id: number };

export type ValidateApplyEvent =
  | { phase: "removing"; done: number; total: number; removed: number }
  | { phase: "done"; removed: number }
  | { phase: "error"; error: string };

/** POST /api/programs/validate-csv/apply -- commits the removals a prior
 *  /api/programs/validate-csv preview proposed. Body: { removals: [{
 *  subject_id, title_id }, ...] }, normally the preview's `toRemove` list
 *  (minus anything the librarian unchecked). Every delete is additionally
 *  scoped to manual=0 server-side, so a locked match can never be removed
 *  this way even if a stale/tampered payload includes it.
 *
 *  Streams progress (one course at a time, in order) as newline-delimited
 *  JSON instead of a single response -- a validated CSV can cover many
 *  courses, and a librarian watching a silent multi-second request has no
 *  way to tell it's actually making progress. */
export async function POST(req: Request) {
  const db = serviceClient();
  const email = userEmailFromRequest(req);
  const perms = await getUserPermissions(db, email);
  if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
    return new Response(JSON.stringify({ error: "Your account doesn't have permission to change assignments." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({})) as { removals?: Removal[] };
  const removals = (body.removals ?? [])
    .filter((r) => Number.isFinite(Number(r.subject_id)) && Number.isFinite(Number(r.title_id)))
    .map((r) => ({ subject_id: Number(r.subject_id), title_id: Number(r.title_id) }));
  if (!removals.length) {
    return new Response(JSON.stringify({ error: "No removals given." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const bySubject = new Map<number, number[]>();
  for (const r of removals) {
    if (!bySubject.has(r.subject_id)) bySubject.set(r.subject_id, []);
    bySubject.get(r.subject_id)!.push(r.title_id);
  }
  const subjectEntries = Array.from(bySubject.entries());

  const stream = ndjsonStream<ValidateApplyEvent>(async (send) => {
    let removed = 0;
    let done = 0;
    send({ phase: "removing", done, total: subjectEntries.length, removed });
    for (const [subjectId, titleIds] of subjectEntries) {
      const { data, error } = await db.from("assignments")
        .delete().eq("subject_id", subjectId).eq("manual", 0).in("title_id", titleIds)
        .select("id");
      if (error) throw error;
      removed += data?.length ?? 0;
      done++;
      send({ phase: "removing", done, total: subjectEntries.length, removed });
    }

    await logActivity(db, {
      userEmail: email, action: "assignment_validate_csv",
      summary: `${email || "Someone"} removed ${removed} title-course match${removed === 1 ? "" : "es"} not confirmed by a CSV validation upload`,
      detail: { removed, subjects: subjectEntries.length },
    });
    send({ phase: "done", removed });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
