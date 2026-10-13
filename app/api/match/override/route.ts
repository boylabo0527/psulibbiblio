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
    if (!subject_id || !title_id) {
      return NextResponse.json({ error: "subject_id and title_id required" }, { status: 400 });
    }

    // Lock/unlock an EXISTING match in place -- flips assignments.manual
    // without touching score/rank/explanation or the row's presence. A
    // locked (manual=1) row is never deleted or replaced by a Match run,
    // even though the course itself keeps getting re-matched for newly
    // added books.
    if ("lock" in body) {
      const lock = body.lock !== false;
      const { data, error } = await db.from("assignments")
        .update({ manual: lock ? 1 : 0 })
        .eq("subject_id", subject_id).eq("title_id", title_id)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "No such match to lock/unlock" }, { status: 404 });
      // Locking is an explicit "this belongs" decision -- clears any
      // earlier rejection of the same pair so a future unlock+rematch
      // isn't fighting a stale record (see rejected_matches).
      if (lock) {
        await db.from("rejected_matches").delete().eq("subject_id", subject_id).eq("title_id", title_id);
      }
      const [{ data: subj }, { data: title }] = await Promise.all([
        db.from("subjects").select("course_code, course_title").eq("id", subject_id).maybeSingle(),
        db.from("titles").select("title").eq("id", title_id).maybeSingle(),
      ]);
      await logActivity(db, {
        userEmail: userEmailFromRequest(req), action: lock ? "assignment_lock" : "assignment_unlock",
        summary: `${lock ? "Locked" : "Unlocked"} title "${title?.title ?? title_id}" on "${subj?.course_code || subj?.course_title || subject_id}"${lock ? " — Match runs will keep it" : ""}`,
        detail: { subject_id, title_id },
      });
      return NextResponse.json({ ok: true });
    }

    const keep = body.keep !== false;
    if (keep) {
      const { error } = await db.from("assignments").upsert(
        { subject_id, title_id, score: 1, rank: 0, explanation: "Manual", manual: 1 },
        { onConflict: "subject_id,title_id" },
      );
      if (error) throw error;
      // Explicitly re-adding a title overrides any earlier rejection.
      await db.from("rejected_matches").delete().eq("subject_id", subject_id).eq("title_id", title_id);
    } else {
      const { error } = await db.from("assignments")
        .delete().eq("subject_id", subject_id).eq("title_id", title_id);
      if (error) throw error;
      // Remembers this was a deliberate rejection, not just an absence --
      // see rejected_matches / app/api/match/run, which checks this
      // before re-suggesting a candidate on the next Match run.
      const { error: rejErr } = await db.from("rejected_matches")
        .upsert({ subject_id, title_id, rejected_by: userEmailFromRequest(req) || null }, { onConflict: "subject_id,title_id" });
      if (rejErr) throw rejErr;
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
