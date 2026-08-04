import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DOMAIN = "psu.palawan.edu.ph";
const DEFAULT_ROLE_NAME = "Faculty Member";

/** POST /api/auth/provision-google -- called once by app/auth/callback
 *  right after a Google sign-in completes. Enforces the domain restriction
 *  server-side (the "hd" param on the Google auth request is only a UI
 *  hint and doesn't actually block other domains), and grants the default
 *  Faculty Member role on a user's very first sign-in -- every other
 *  account in this app only gets a role when an admin assigns one by hand
 *  in User Management, but Google's own auth already vouches for identity
 *  here, so a first-time @psu.palawan.edu.ph sign-in is trusted the same
 *  way. Never overwrites a role an admin already assigned. */
export async function POST(req: Request) {
  try {
    const email = userEmailFromRequest(req);
    if (!email) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
      return NextResponse.json(
        { error: `Only @${ALLOWED_DOMAIN} accounts can sign in with Google.` },
        { status: 403 },
      );
    }

    const db = serviceClient();
    const { data: existing } = await db
      .from("user_roles").select("role_id, roles(name)").eq("email", email).maybeSingle();
    if (existing) {
      const roleName = (existing.roles as unknown as { name: string } | null)?.name ?? null;
      return NextResponse.json({ ok: true, role: roleName, alreadyAssigned: true });
    }

    const { data: role } = await db.from("roles").select("id, name").eq("name", DEFAULT_ROLE_NAME).maybeSingle();
    if (!role) {
      return NextResponse.json(
        { error: `Default role "${DEFAULT_ROLE_NAME}" doesn't exist yet -- run the latest Supabase migration.` },
        { status: 500 },
      );
    }

    const { error: insErr } = await db.from("user_roles").insert({ email, role_id: role.id });
    if (insErr && insErr.code !== "23505") throw insErr; // 23505 = a concurrent request already assigned one

    await logActivity(db, {
      userEmail: email, action: "user_role_assign",
      summary: `Auto-assigned "${role.name}" to ${email} on first Google sign-in`,
      detail: { email, role_id: role.id, via: "google_oauth" },
    });
    return NextResponse.json({ ok: true, role: role.name, alreadyAssigned: false });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
