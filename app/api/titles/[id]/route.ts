import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRING_FIELDS = ["title", "author", "publisher", "year", "isbn", "issn", "call_no", "url"] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid title id" }, { status: 400 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, string | number> = {};
    for (const k of STRING_FIELDS) {
      if (typeof body[k] === "string") patch[k] = (body[k] as string).trim();
    }
    if (typeof body.copies === "number" && Number.isFinite(body.copies)) {
      patch.copies = Math.max(0, Math.floor(body.copies));
    } else if (typeof body.copies === "string" && body.copies.trim()) {
      const n = parseInt(body.copies.trim(), 10);
      if (Number.isFinite(n)) patch.copies = Math.max(0, n);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }
    if ("title" in patch && !patch.title) {
      return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    }
    const db = serviceClient();
    const { data, error } = await db
      .from("titles")
      .update(patch)
      .eq("id", id)
      .select("id, title, author, publisher, year, isbn, issn, call_no, copies, url, format")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, title: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
