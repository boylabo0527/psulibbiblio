import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normField = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** PATCH /api/titles/:id — update editable title fields.
 *  Allowed: title, author, publisher, year, isbn, issn, call_no, copies,
 *  url, campus. format is intentionally NOT editable.
 *
 *  For printed books, if the edit makes this row an exact match (call_no +
 *  title + author + campus, case/whitespace-insensitive) of another
 *  existing title, the two are merged: copies are summed onto whichever
 *  row was created first, assignments are moved over, and the edited row
 *  is deleted rather than left behind as a duplicate. */
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
      const merged = await mergeIfDuplicate(db, data);
      if (merged) return NextResponse.json({ title: merged, merged: true });
    }

    return NextResponse.json({ title: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

type TitleRow = {
  id: number; format: string; call_no: string; title: string; author: string;
  campus: string; copies: number;
};

async function mergeIfDuplicate(
  db: ReturnType<typeof serviceClient>, edited: TitleRow,
): Promise<TitleRow | null> {
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
  ) as TitleRow | undefined;
  if (!match) return null;

  const keepId = Math.min(match.id, edited.id);
  const dropId = Math.max(match.id, edited.id);
  const keepRow = keepId === match.id ? match : edited;
  const dropRow = keepId === match.id ? edited : match;
  const newCopies = (keepRow.copies ?? 1) + (dropRow.copies ?? 1);

  // Move assignments off the dropped row onto the kept row; if the kept row
  // is already assigned to the same subject, just drop the redundant one.
  const { data: dropAssignments, error: assignErr } = await db.from("assignments")
    .select("id, subject_id").eq("title_id", dropId);
  if (assignErr) throw assignErr;
  for (const a of dropAssignments ?? []) {
    const { error: updErr } = await db.from("assignments").update({ title_id: keepId }).eq("id", a.id);
    if (updErr) {
      await db.from("assignments").delete().eq("id", a.id);
    }
  }

  const { error: copiesErr } = await db.from("titles").update({ copies: newCopies }).eq("id", keepId);
  if (copiesErr) throw copiesErr;
  const { error: delErr } = await db.from("titles").delete().eq("id", dropId);
  if (delErr) throw delErr;

  const { data: finalRow, error: finalErr } = await db.from("titles").select().eq("id", keepId).single();
  if (finalErr) throw finalErr;
  return finalRow as TitleRow;
}
