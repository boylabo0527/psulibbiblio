import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/programs/:id — rename a program. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad program id" }, { status: 400 });
    }
    const body = await req.json() as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Program name is required." }, { status: 400 });
    }
    const db = serviceClient();
    const { data, error } = await db.from("programs").update({ name }).eq("id", id).select("id, name").single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `A program named "${name}" already exists.` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ program: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** DELETE /api/programs/:id — remove a program.
 *  Refuses if the program still has subjects, so a duplicate/mistaken
 *  program can be deleted safely without silently losing curriculum data;
 *  the caller must delete/move those subjects first. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad program id" }, { status: 400 });
    }
    const db = serviceClient();

    const { count, error: countErr } = await db.from("subjects")
      .select("id", { count: "exact", head: true }).eq("program_id", id);
    if (countErr) throw countErr;
    if (count && count > 0) {
      return NextResponse.json(
        { error: `This program still has ${count} subject(s). Remove or reassign them before deleting the program.` },
        { status: 409 },
      );
    }

    const { error } = await db.from("programs").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
