import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: Request, db: ReturnType<typeof serviceClient>) {
  const email = userEmailFromRequest(req);
  const perms = await getUserPermissions(db, email);
  if (!perms.isAdmin) throw new Error("Admin access required.");
  return email;
}

/** GET /api/admin/users -- every email->role assignment. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    await requireAdmin(req, db);
    const { data, error } = await db
      .from("user_roles")
      .select("email, role_id, created_at, roles(name, is_admin)")
      .order("email");
    if (error) throw error;
    const users = (data ?? []).map((u) => ({
      email: u.email,
      role_id: u.role_id,
      created_at: u.created_at,
      role_name: (u.roles as unknown as { name: string; is_admin: boolean } | null)?.name ?? null,
      is_admin: (u.roles as unknown as { name: string; is_admin: boolean } | null)?.is_admin ?? false,
    }));
    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** POST /api/admin/users -- assign (or reassign) a role to an email.
 *  Body: { email, role_id }. Does not create the Supabase Auth account --
 *  that's still done in Supabase's dashboard, per the existing no-signup
 *  flow; this only grants app permissions to an email once it exists. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const callerEmail = await requireAdmin(req, db);
    const body = await req.json() as { email?: string; role_id?: number };
    const email = (body.email ?? "").trim().toLowerCase();
    const roleId = body.role_id;
    if (!email || !Number.isFinite(roleId)) {
      return NextResponse.json({ error: "email and role_id are required" }, { status: 400 });
    }
    const { data: role } = await db.from("roles").select("name").eq("id", roleId as number).maybeSingle();
    if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

    const { error } = await db.from("user_roles").upsert({ email, role_id: roleId }, { onConflict: "email" });
    if (error) throw error;
    await logActivity(db, {
      userEmail: callerEmail, action: "user_role_assign",
      summary: `Assigned "${role.name}" to ${email}`,
      detail: { email, role_id: roleId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** DELETE /api/admin/users?email=... -- revoke an assignment. Refuses to
 *  remove the last remaining admin, so the app can't lock itself out. */
export async function DELETE(req: Request) {
  try {
    const db = serviceClient();
    const callerEmail = await requireAdmin(req, db);
    const email = (new URL(req.url).searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const { data: target } = await db
      .from("user_roles").select("role_id, roles(is_admin)").eq("email", email).maybeSingle();
    if (!target) return NextResponse.json({ error: "No assignment found for that email" }, { status: 404 });

    const isTargetAdmin = (target.roles as unknown as { is_admin: boolean } | null)?.is_admin;
    if (isTargetAdmin) {
      const { count } = await db
        .from("user_roles").select("email", { count: "exact", head: true })
        .eq("role_id", target.role_id);
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: "Can't remove the last admin -- assign another admin first." }, { status: 400 });
      }
    }

    const { error } = await db.from("user_roles").delete().eq("email", email);
    if (error) throw error;
    await logActivity(db, {
      userEmail: callerEmail, action: "user_role_remove",
      summary: `Removed role assignment for ${email}`,
      detail: { email },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}
