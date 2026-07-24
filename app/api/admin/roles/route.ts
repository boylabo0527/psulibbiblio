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

/** GET /api/admin/roles -- every role with its per-tab permissions. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    await requireAdmin(req, db);

    const { data: roles, error: rolesErr } = await db.from("roles").select("id, name, is_admin").order("id");
    if (rolesErr) throw rolesErr;
    const { data: perms, error: permsErr } = await db.from("role_tab_permissions").select("role_id, tab_id, can_view, can_edit");
    if (permsErr) throw permsErr;

    const byRole = new Map<number, Record<string, { can_view: boolean; can_edit: boolean }>>();
    for (const p of perms ?? []) {
      if (!byRole.has(p.role_id)) byRole.set(p.role_id, {});
      byRole.get(p.role_id)![p.tab_id] = { can_view: p.can_view, can_edit: p.can_edit };
    }

    const result = (roles ?? []).map((r: { id: number; name: string; is_admin: boolean }) => ({
      ...r,
      permissions: byRole.get(r.id) ?? {},
    }));
    return NextResponse.json({ roles: result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** POST /api/admin/roles -- create a new custom role. Body: { name }. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = await requireAdmin(req, db);
    const body = await req.json() as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Role name is required." }, { status: 400 });

    const { data, error } = await db.from("roles").insert({ name, is_admin: false }).select("id, name, is_admin").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: `A role named "${name}" already exists.` }, { status: 409 });
      throw error;
    }
    await logActivity(db, { userEmail: email, action: "role_create", summary: `Created role "${name}"`, detail: { role_id: data.id } });
    return NextResponse.json({ role: { ...data, permissions: {} } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** PATCH /api/admin/roles -- set one tab's view/edit permission for one
 *  role. Body: { role_id, tab_id, can_view, can_edit }. Rejects attempts
 *  to modify an is_admin role -- those are always full-access. */
export async function PATCH(req: Request) {
  try {
    const db = serviceClient();
    const email = await requireAdmin(req, db);
    const body = await req.json() as { role_id?: number; tab_id?: string; can_view?: boolean; can_edit?: boolean };
    const roleId = body.role_id;
    const tabId = (body.tab_id ?? "").trim();
    if (!Number.isFinite(roleId) || !tabId) {
      return NextResponse.json({ error: "role_id and tab_id are required" }, { status: 400 });
    }

    const { data: role } = await db.from("roles").select("id, name, is_admin").eq("id", roleId as number).maybeSingle();
    if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
    if (role.is_admin) return NextResponse.json({ error: "The Admin role always has full access and can't be changed." }, { status: 400 });

    const can_view = !!body.can_view;
    const can_edit = !!body.can_edit && can_view; // can't edit a tab you can't view
    const { error } = await db.from("role_tab_permissions").upsert(
      { role_id: roleId, tab_id: tabId, can_view, can_edit },
      { onConflict: "role_id,tab_id" },
    );
    if (error) throw error;
    await logActivity(db, {
      userEmail: email, action: "role_permission_edit",
      summary: `Set "${role.name}" permissions for ${tabId}: view=${can_view}, edit=${can_edit}`,
      detail: { role_id: roleId, tab_id: tabId, can_view, can_edit },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** DELETE /api/admin/roles?id=... -- remove a custom role. Refuses if any
 *  user is still assigned to it, or if it's an is_admin role. */
export async function DELETE(req: Request) {
  try {
    const db = serviceClient();
    const email = await requireAdmin(req, db);
    const id = parseInt(new URL(req.url).searchParams.get("id") ?? "", 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad role id" }, { status: 400 });

    const { data: role } = await db.from("roles").select("id, name, is_admin").eq("id", id).maybeSingle();
    if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
    if (role.is_admin) return NextResponse.json({ error: "The Admin role can't be deleted." }, { status: 400 });

    const { count } = await db.from("user_roles").select("email", { count: "exact", head: true }).eq("role_id", id);
    if (count && count > 0) {
      return NextResponse.json({ error: `${count} user(s) still have this role. Reassign them first.` }, { status: 409 });
    }

    const { error } = await db.from("roles").delete().eq("id", id);
    if (error) throw error;
    await logActivity(db, { userEmail: email, action: "role_delete", summary: `Deleted role "${role.name}"`, detail: { role_id: id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}
