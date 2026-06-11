import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = serviceClient();
    const { data, error } = await db.from("programs")
      .select("id, name").order("name");
    if (error) throw error;
    return NextResponse.json({ programs: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}
