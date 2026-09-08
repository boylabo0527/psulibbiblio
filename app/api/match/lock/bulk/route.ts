import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { subject_id: number; title_id: number };

/** POST /api/match/lock/bulk -- lock (or unlock) several existing matches
 *  at once, across one or many courses in a single request. Body: {
 *  items: [{ subject_id, title_id }, ...], lock? }. Locking flips
 *  assignments.manual so a Match run never deletes/replaces that match,
 *  even though the course itself keeps getting re-matched for new books --
 *  same semantics as the single-title lock button and /api/match/override,
 *  just for many rows at once (e.g. every match a CSV validation upload
 *  confirmed, or a librarian's own multi-select in Programs & Export). */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
    }

    const body = await req.json() as { items?: Item[]; lock?: boolean };
    const lock = body.lock !== false;
    const items = (body.items ?? [])
      .filter((i) => Number.isFinite(Number(i.subject_id)) && Number.isFinite(Number(i.title_id)))
      .map((i) => ({ subject_id: Number(i.subject_id), title_id: Number(i.title_id) }));
    if (!items.length) return NextResponse.json({ error: "No items given." }, { status: 400 });

    const bySubject = new Map<number, number[]>();
    for (const i of items) {
      if (!bySubject.has(i.subject_id)) bySubject.set(i.subject_id, []);
      bySubject.get(i.subject_id)!.push(i.title_id);
    }

    let updated = 0;
    for (const [subjectId, titleIds] of bySubject) {
      const { data, error } = await db.from("assignments")
        .update({ manual: lock ? 1 : 0 })
        .eq("subject_id", subjectId).in("title_id", titleIds)
        .select("id");
      if (error) throw error;
      updated += data?.length ?? 0;
    }

    await logActivity(db, {
      userEmail: email, action: "assignment_bulk_lock",
      summary: `${email || "Someone"} ${lock ? "locked" : "unlocked"} ${updated} title-course match${updated === 1 ? "" : "es"}`,
      detail: { updated, subjects: bySubject.size, lock },
    });
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
