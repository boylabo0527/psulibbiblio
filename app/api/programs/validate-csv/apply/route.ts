import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Removal = { subject_id: number; title_id: number };

/** POST /api/programs/validate-csv/apply -- commits the removals a prior
 *  /api/programs/validate-csv preview proposed. Body: { removals: [{
 *  subject_id, title_id }, ...] }, normally the preview's `toRemove` list
 *  (minus anything the librarian unchecked). Every delete is additionally
 *  scoped to manual=0 server-side, so a locked match can never be removed
 *  this way even if a stale/tampered payload includes it. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
    }

    const body = await req.json() as { removals?: Removal[] };
    const removals = (body.removals ?? [])
      .filter((r) => Number.isFinite(Number(r.subject_id)) && Number.isFinite(Number(r.title_id)))
      .map((r) => ({ subject_id: Number(r.subject_id), title_id: Number(r.title_id) }));
    if (!removals.length) return NextResponse.json({ error: "No removals given." }, { status: 400 });

    const bySubject = new Map<number, number[]>();
    for (const r of removals) {
      if (!bySubject.has(r.subject_id)) bySubject.set(r.subject_id, []);
      bySubject.get(r.subject_id)!.push(r.title_id);
    }

    let removed = 0;
    for (const [subjectId, titleIds] of bySubject) {
      const { data, error } = await db.from("assignments")
        .delete().eq("subject_id", subjectId).eq("manual", 0).in("title_id", titleIds)
        .select("id");
      if (error) throw error;
      removed += data?.length ?? 0;
    }

    await logActivity(db, {
      userEmail: email, action: "assignment_validate_csv",
      summary: `${email || "Someone"} removed ${removed} title-course match${removed === 1 ? "" : "es"} not confirmed by a CSV validation upload`,
      detail: { removed, subjects: bySubject.size },
    });
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
