import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { mergeTitles, type MergeableTitle } from "@/lib/merge-titles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normField = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** PATCH /api/titles/:id — update editable title fields.
 *  Allowed: title, author, publisher, year, isbn, issn, call_no, copies,
 *  url, campus. format is intentionally NOT editable.
 *
 *  For printed books, if the edit makes this row an exact match (call_no +
 *  title + author + campus, case/whitespace-insensitive) of another
 *  existing title, the two are merged rather than left as a duplicate. */
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

    if (data.format === "book_printed") {
      const match = await findDuplicate(db, data);
      if (match) {
        const merged = await mergeTitles(db, data, match);
        return NextResponse.json({ title: merged, merged: true });
      }
    }

    return NextResponse.json({ title: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

async function findDuplicate(
  db: ReturnType<typeof serviceClient>, edited: MergeableTitle,
): Promise<MergeableTitle | null> {
  const { data: candidates, error: candErr } = await db.from("titles")
    .select("id, format, call_no, title, author, campus, copies")
    .eq("format", edited.format)
    .eq("campus", edited.campus ?? "")
    .neq("id", edited.id);
  if (candErr) throw candErr;

  const match = (candidates ?? []).find((c) =>
    normField(c.call_no) === normField(edited.call_no) &&
    normField(c.title) === normField(edited.title) &&
    normField(c.author) === normField(edited.author),
  ) as MergeableTitle | undefined;
  return match ?? null;
}
