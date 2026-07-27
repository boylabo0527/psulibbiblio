import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Dashboard is intentionally public, so this route stays reachable
// without an email -- an anonymous visitor is always unrestricted (there's
// no per-user campus scope to apply). A signed-in user restricted to
// specific campuses only sees programs offered there.
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    let allowedProgramIds: Set<number> | null = null;
    if (email) {
      const perms = await getUserPermissions(db, email);
      if (perms.campusIds !== null) allowedProgramIds = await getAllowedProgramIds(db, perms.campusIds);
    }

    let q = db.from("programs").select("id, name, cost_per_title").order("name");
    if (allowedProgramIds) {
      q = q.in("id", allowedProgramIds.size ? Array.from(allowedProgramIds) : [-1]);
    }
    const { data, error } = await q;
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
