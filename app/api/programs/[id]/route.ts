import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid program id" }, { status: 400 });
    }
    const db = serviceClient();

    // .select() forces Postgrest to return the deleted rows so we can
    // distinguish "row not found" from a silent RLS / FK suppression.
    const { data, error } = await db
      .from("programs")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: `Program ${id} not found.` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted_id: id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
