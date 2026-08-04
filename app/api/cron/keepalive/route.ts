import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cron/keepalive -- runs a trivial read against Supabase once a
 *  day (see the "crons" entry in vercel.json) purely to register activity.
 *  Supabase's free tier auto-pauses a project after 7 days with no
 *  traffic, which is what actually happened here: the pause warning
 *  arrived, and while the project can be unpaused from the dashboard
 *  within 90 days, this exists so it doesn't happen again.
 *
 *  Authenticated via CRON_SECRET, not a signed-in Supabase user -- Vercel
 *  Cron has no user to sign in as. Set CRON_SECRET in Vercel's project
 *  env vars (any random string; `openssl rand -hex 32` works) and Vercel
 *  automatically sends it as `Authorization: Bearer <CRON_SECRET>` on
 *  every cron-triggered request -- see the bypass for /api/cron/ in
 *  middleware.ts, which skips the normal Supabase-session check for this
 *  path specifically so this verification can run instead. */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = serviceClient();
    const { error } = await db.from("campuses").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
