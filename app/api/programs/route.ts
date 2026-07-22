import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Decode (not verify) a JWT's payload for diagnostics — role + project ref + issued-at. */
function jwtInfo(token: string | undefined): { role: string; ref: string; iat: string } {
  if (!token) return { role: "(unset)", ref: "(unset)", iat: "(unset)" };
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf-8");
    const claims = JSON.parse(json) as { role?: string; ref?: string; iat?: number };
    return {
      role: claims.role ?? "(no role claim)",
      ref: claims.ref ?? "(no ref claim)",
      iat: claims.iat ? new Date(claims.iat * 1000).toISOString() : "(no iat claim)",
    };
  } catch {
    return { role: "(unparseable)", ref: "(unparseable)", iat: "(unparseable)" };
  }
}

export async function GET() {
  const noStore = { headers: { "Cache-Control": "no-store, must-revalidate" } };
  let supabaseHost = "";
  try {
    supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch { /* leave blank if unset/invalid */ }
  const keyInfo = jwtInfo(process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const db = serviceClient();
    const { data, error } = await db.from("programs")
      .select("id, name").order("name");
    if (error) throw error;
    return NextResponse.json({ programs: data ?? [], debug: { supabaseHost, ...keyInfo, count: data?.length ?? 0 } }, noStore);
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg, debug: { supabaseHost, ...keyInfo } }, { status: 500, ...noStore });
  }
}
