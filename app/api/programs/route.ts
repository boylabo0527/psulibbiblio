import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = serviceClient();
    const { data, error } = await db.from("programs")
      .select("id, name, cost_per_title").order("name");
    if (error) throw error;
    return NextResponse.json({ programs: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to add programs." }, { status: 403 });
    }
    const body = await req.json() as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Program name is required." }, { status: 400 });
    }
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
