import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const noStore = { headers: { "Cache-Control": "no-store, must-revalidate" } };
  let supabaseHost = "";
  try {
    supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch { /* leave blank if unset/invalid */ }
  try {
    const db = serviceClient();
    const { data, error } = await db.from("programs")
      .select("id, name").order("name");
    if (error) throw error;
    return NextResponse.json({ programs: data ?? [], debug: { supabaseHost, count: data?.length ?? 0 } }, noStore);
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg, debug: { supabaseHost } }, { status: 500, ...noStore });
  }
}
