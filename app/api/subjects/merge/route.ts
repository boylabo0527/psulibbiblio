import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/subjects/merge — combine two duplicate courses into one.
 *  Body: { source_id, target_id }. Every title assignment under source_id
 *  moves to target_id (duplicates dropped rather than left as an error),
 *  then source_id is deleted. */
export async function POST(req: Request) {
  try {
    const body = await req.json() as { source_id?: number; target_id?: number };
    const sourceId = body.source_id;
    const targetId = body.target_id;
    if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
      return NextResponse.json({ error: "source_id and target_id are required" }, { status: 400 });
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: "source_id and target_id must differ" }, { status: 400 });
    }
    const db = serviceClient();

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

    return NextResponse.json({ ok: true, moved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
