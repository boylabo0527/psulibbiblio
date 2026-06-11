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

    // assignments has a unique (subject_id, title_id) index, so we can't
    // blindly UPDATE drop assignments to point at keep when the subject is
    // already attached to keep. For every drop:
    //   1. find subject_ids already covered by keep
    //   2. delete drop assignments to those subjects (they're redundant)
    //   3. UPDATE remaining drop assignments to point at keep
    //   4. delete the drop title (cascade removes any leftover assignments,
    //      though step 3 should leave none)
    const { data: keepAssigns, error: keepErr } = await db
      .from("assignments")
      .select("subject_id")
      .eq("title_id", keepId);
    if (keepErr) return NextResponse.json({ error: keepErr.message }, { status: 500 });
    const keepSubjects = new Set<number>((keepAssigns ?? []).map((a) => a.subject_id));

    let moved = 0;
    let pruned = 0;
    for (const dropId of dropIds) {
      const { data: dropAssigns, error: dropErr } = await db
        .from("assignments")
        .select("subject_id")
        .eq("title_id", dropId);
      if (dropErr) return NextResponse.json({ error: dropErr.message }, { status: 500 });

      const conflictSubjects = (dropAssigns ?? [])
        .map((a) => a.subject_id)
        .filter((sid) => keepSubjects.has(sid));
      if (conflictSubjects.length > 0) {
        const { error: pruneErr, count } = await db
          .from("assignments")
          .delete({ count: "exact" })
          .eq("title_id", dropId)
          .in("subject_id", conflictSubjects);
        if (pruneErr) return NextResponse.json({ error: pruneErr.message }, { status: 500 });
        pruned += count ?? 0;
      }

      const { error: updErr, count } = await db
        .from("assignments")
        .update({ title_id: keepId }, { count: "exact" })
        .eq("title_id", dropId);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      moved += count ?? 0;

      for (const a of dropAssigns ?? []) keepSubjects.add(a.subject_id);
    }

    const { error: titleDelErr } = await db.from("titles").delete().in("id", dropIds);
    if (titleDelErr) return NextResponse.json({ error: titleDelErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      moved_assignments: moved,
      pruned_assignments: pruned,
      deleted_titles: dropIds.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
