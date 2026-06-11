import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { keep_id?: number; drop_ids?: number[] };
    const keepId = Number(body.keep_id);
    const dropIds = (body.drop_ids ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n !== keepId);
    if (!Number.isFinite(keepId) || dropIds.length === 0) {
      return NextResponse.json({ error: "keep_id and at least one drop_id required" }, { status: 400 });
    }
    const db = serviceClient();

    // Confirm the keeper actually exists. If it doesn't, the UPDATE below
    // would fail with a foreign-key violation that's hard to interpret.
    const { data: keeper, error: keepLookupErr } = await db
      .from("programs").select("id").eq("id", keepId).maybeSingle();
    if (keepLookupErr) {
      return NextResponse.json({ error: `Keeper lookup failed: ${keepLookupErr.message}` }, { status: 500 });
    }
    if (!keeper) {
      return NextResponse.json({ error: `Keeper program ${keepId} not found.` }, { status: 404 });
    }

    // Move subjects from the dropped programs to the keeper. .select() forces
    // Postgrest to return the affected rows so we can report a count and so
    // any RLS / FK error surfaces immediately.
    const { data: moved, error: mvErr } = await db
      .from("subjects")
      .update({ program_id: keepId })
      .in("program_id", dropIds)
      .select("id");
    if (mvErr) {
      return NextResponse.json({ error: `Move subjects failed: ${mvErr.message}` }, { status: 500 });
    }

    const { data: deleted, error: delErr } = await db
      .from("programs")
      .delete()
      .in("id", dropIds)
      .select("id");
    if (delErr) {
      return NextResponse.json({ error: `Delete programs failed: ${delErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      moved_subjects: moved?.length ?? 0,
      deleted_programs: deleted?.length ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
