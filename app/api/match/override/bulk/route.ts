import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/match/override/bulk -- remove several titles from one course
 *  in a single request, instead of one /api/match/override call per title.
 *  Removes regardless of a match's locked (manual) state, same as the
 *  single-title remove button -- locking only protects a match from being
 *  auto-dropped by a Match run, not from a librarian removing it directly. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
    }
    const body = await req.json();
    const subject_id = Number(body.subject_id);
    const title_ids = Array.isArray(body.title_ids)
      ? [...new Set(body.title_ids.map(Number).filter((n: number) => Number.isFinite(n) && n > 0))]
      : [];
    if (!subject_id || title_ids.length === 0) {
      return NextResponse.json({ error: "subject_id and a non-empty title_ids array are required" }, { status: 400 });
    }

    const { error } = await db.from("assignments")
      .delete().eq("subject_id", subject_id).in("title_id", title_ids);
    if (error) throw error;

    const { data: subj } = await db.from("subjects").select("course_code, course_title").eq("id", subject_id).maybeSingle();
    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: "assignment_bulk_remove",
      summary: `Removed ${title_ids.length} title${title_ids.length === 1 ? "" : "s"} from "${subj?.course_code || subj?.course_title || subject_id}"`,
      detail: { subject_id, title_ids },
    });
    return NextResponse.json({ ok: true, removed: title_ids.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
