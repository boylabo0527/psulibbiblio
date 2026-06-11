import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { keep_id?: number; drop_ids?: number[] };
    const keepId = Number(body.keep_id);
    const dropIds = (body.drop_ids ?? []).map(Number).filter((n) => Number.isFinite(n) && n !== keepId);
    if (!Number.isFinite(keepId) || dropIds.length === 0) {
      return NextResponse.json({ error: "keep_id and at least one drop_id required" }, { status: 400 });
    }
    const db = serviceClient();

    // Move every subject from the dropped programs over to the keeper, then
    // delete the now-empty programs. assignments follow subjects automatically
    // because they reference subject_id, not program_id.
    const { error: mvErr, count: moved } = await db
      .from("subjects")
      .update({ program_id: keepId }, { count: "exact" })
      .in("program_id", dropIds);
    if (mvErr) return NextResponse.json({ error: mvErr.message }, { status: 500 });

    const { error: delErr } = await db.from("programs").delete().in("id", dropIds);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, moved_subjects: moved ?? 0, deleted_programs: dropIds.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
