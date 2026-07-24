import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/subjects/merge — combine two duplicate courses into one.
 *  Body: { source_id, target_id }. Every title assignment under source_id
 *  moves to target_id (duplicates dropped rather than left as an error),
 *  then source_id is deleted. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to merge courses." }, { status: 403 });
    }
    const body = await req.json() as { source_id?: number; target_id?: number };
    const sourceId = body.source_id;
    const targetId = body.target_id;
    if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
      return NextResponse.json({ error: "source_id and target_id are required" }, { status: 400 });
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: "source_id and target_id must differ" }, { status: 400 });
    }

    const { data: srcSubj } = await db.from("subjects").select("course_code, course_title").eq("id", sourceId as number).maybeSingle();
    const { data: tgtSubj } = await db.from("subjects").select("course_code, course_title").eq("id", targetId as number).maybeSingle();

    const { data: assigns, error: assignErr } = await db.from("assignments")
      .select("id").eq("subject_id", sourceId as number);
    if (assignErr) throw assignErr;

    let moved = 0;
    for (const a of assigns ?? []) {
      const { error: updErr } = await db.from("assignments").update({ subject_id: targetId }).eq("id", a.id);
      if (updErr) {
        await db.from("assignments").delete().eq("id", a.id);
      } else {
        moved++;
      }
    }

    const { error: delErr } = await db.from("subjects").delete().eq("id", sourceId as number);
    if (delErr) throw delErr;

    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: "subject_merge",
      summary: `Merged course "${srcSubj?.course_code || srcSubj?.course_title || "?"}" into "${tgtSubj?.course_code || tgtSubj?.course_title || "?"}" (${moved} assignment${moved === 1 ? "" : "s"} moved)`,
      detail: { source_id: sourceId, target_id: targetId, moved },
    });
    return NextResponse.json({ ok: true, moved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
