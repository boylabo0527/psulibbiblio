import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function POST(req: Request) {
  try {
    const expected = process.env.ADMIN_RESET_PASSWORD;
    if (!expected) {
      return NextResponse.json(
        { error: "Server is missing ADMIN_RESET_PASSWORD. Set it in the project environment to enable wipe." },
        { status: 503 },
      );
    }
    let body: { password?: string } = {};
    try { body = await req.json(); } catch { /* allow empty */ }
    const supplied = (body.password ?? "").trim();
    if (!supplied || !timingSafeEqual(supplied, expected)) {
      return NextResponse.json({ error: "Invalid admin password." }, { status: 401 });
    }
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
