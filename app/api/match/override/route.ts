import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
    }
    const body = await req.json();
    const subject_id = Number(body.subject_id);
    const title_id = Number(body.title_id);
    const keep = body.keep !== false;
    if (!subject_id || !title_id) {
      return NextResponse.json({ error: "subject_id and title_id required" }, { status: 400 });
    }
    if (keep) {
      const { error } = await db.from("assignments").upsert(
        { subject_id, title_id, score: 1, rank: 0, explanation: "Manual", manual: 1 },
        { onConflict: "subject_id,title_id" },
      );
      if (error) throw error;
    } else {
      const { error } = await db.from("assignments")
        .delete().eq("subject_id", subject_id).eq("title_id", title_id);
      if (error) throw error;
    }
    const [{ data: subj }, { data: title }] = await Promise.all([
      db.from("subjects").select("course_code, course_title").eq("id", subject_id).maybeSingle(),
      db.from("titles").select("title").eq("id", title_id).maybeSingle(),
    ]);
    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: keep ? "assignment_add" : "assignment_remove",
      summary: `${keep ? "Added" : "Removed"} title "${title?.title ?? title_id}" ${keep ? "to" : "from"} "${subj?.course_code || subj?.course_title || subject_id}"`,
      detail: { subject_id, title_id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
