import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/activity/revert — undo an upload batch by deleting exactly the
 *  rows it inserted (identified by batch_id), plus any assignments that
 *  reference them. Only revertible, not-yet-reverted log entries can be
 *  reverted, and only once. */
export async function POST(req: Request) {
  try {
    const body = await req.json() as { activity_id?: number };
    const activityId = body.activity_id;
    if (!Number.isFinite(activityId)) {
      return NextResponse.json({ error: "activity_id is required" }, { status: 400 });
    }
    const db = serviceClient();

    const { data: log, error: logErr } = await db.from("activity_log")
      .select("*").eq("id", activityId as number).maybeSingle();
    if (logErr) throw logErr;
    if (!log) return NextResponse.json({ error: "Activity entry not found" }, { status: 404 });
    if (!log.revertible) return NextResponse.json({ error: "This action can't be reverted" }, { status: 400 });
    if (log.reverted_at) return NextResponse.json({ error: "Already reverted" }, { status: 400 });
    if (!log.batch_id) return NextResponse.json({ error: "No batch to revert" }, { status: 400 });

    const table = log.action === "upload_subjects" ? "subjects" : "titles";
    const idCol = table === "subjects" ? "subject_id" : "title_id";

    const { data: rows, error: rowsErr } = await db.from(table).select("id").eq("batch_id", log.batch_id);
    if (rowsErr) throw rowsErr;
    const ids = (rows ?? []).map((r: { id: number }) => r.id);

    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error } = await db.from("assignments").delete().in(idCol, slice);
      if (error) throw error;
    }
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error } = await db.from(table).delete().in("id", slice);
      if (error) throw error;
    }

    await db.from("activity_log").update({ reverted_at: new Date().toISOString() }).eq("id", activityId as number);

    const userEmail = userEmailFromRequest(req);
    await logActivity(db, {
      userEmail, action: log.action,
      summary: `Reverted upload: deleted ${ids.length} ${table === "subjects" ? "subject" : "title"}${ids.length === 1 ? "" : "s"} from "${log.summary}"`,
      detail: { reverted_activity_id: activityId, batch_id: log.batch_id, deleted: ids.length },
    });

    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
