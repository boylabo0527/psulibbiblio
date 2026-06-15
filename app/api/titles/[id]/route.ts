import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/titles/:id — update editable title fields.
 *  Allowed: title, author, publisher, year, isbn, issn, call_no, copies,
 *  url, campus. format is intentionally NOT editable. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad title id" }, { status: 400 });
    }
    const body = await req.json() as Record<string, unknown>;
    const allowed = ["title", "author", "publisher", "year", "isbn", "issn", "call_no", "copies", "url", "campus"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const db = serviceClient();
    const { data, error } = await db.from("titles").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json({ title: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
