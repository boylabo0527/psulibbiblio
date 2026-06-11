import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST() {
  try {
    const db = serviceClient();
    await db.from("assignments").delete().gte("id", 0);
    await db.from("subjects").delete().gte("id", 0);
    await db.from("titles").delete().gte("id", 0);
    await db.from("programs").delete().gte("id", 0);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}
