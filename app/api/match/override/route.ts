import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const subject_id = Number(body.subject_id);
    const title_id = Number(body.title_id);
    const keep = body.keep !== false;
    if (!subject_id || !title_id) {
      return NextResponse.json({ error: "subject_id and title_id required" }, { status: 400 });
    }
    const db = serviceClient();
    if (keep) {
      const { error } = await db.from("assignments").upsert(
        { subject_id, title_id, score: 1, rank: 0, explanation: "Manual", manual: 1 },
        { onConflict: "subject_id,title_id" },
      );
      if (error) throw error;
    } else {
      const { error } = await db.from("assignments")
        .delete().eq("subject_id", subject_id).eq("title_id", title_id);
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
