import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Decode (not verify) a JWT's payload to read its "role" claim for diagnostics. */
function jwtRole(token: string | undefined): string {
  if (!token) return "(unset)";
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf-8");
    return (JSON.parse(json) as { role?: string }).role ?? "(no role claim)";
  } catch {
    return "(unparseable)";
  }
}

export async function GET() {
  const noStore = { headers: { "Cache-Control": "no-store, must-revalidate" } };
  let supabaseHost = "";
  try {
    supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch { /* leave blank if unset/invalid */ }
  const keyRole = jwtRole(process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const db = serviceClient();
    const { data, error } = await db.from("programs")
      .select("id, name").order("name");
    if (error) throw error;
    return NextResponse.json({ programs: data ?? [], debug: { supabaseHost, keyRole, count: data?.length ?? 0 } }, noStore);
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg, debug: { supabaseHost, keyRole } }, { status: 500, ...noStore });
  }
}
