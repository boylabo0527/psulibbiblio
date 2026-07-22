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

export async function POST(req: Request) {
  try {
    const body = await req.json() as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Program name is required." }, { status: 400 });
    }
    const db = serviceClient();
    const { data, error } = await db.from("programs").insert({ name }).select("id, name").single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `Program "${name}" already exists.` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ program: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}
