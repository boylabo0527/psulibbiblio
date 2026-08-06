import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/suppliers/:id -- edit a directory entry. Body: any subset of
 *  { name, address, contact_person, phone, email, tin, notes }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad supplier id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["supplier-directory"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to edit suppliers." }, { status: 403 });
    }

    const { data: existing } = await db.from("suppliers").select("id, name").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Supplier not found." }, { status: 404 });

    const body = await req.json() as Record<string, string>;
    const update: Record<string, string> = {};
    for (const f of ["name", "address", "contact_person", "phone", "email", "tin", "notes"] as const) {
      if (body[f] !== undefined) update[f] = body[f].trim();
    }
    if (update.name !== undefined && !update.name) {
      return NextResponse.json({ error: "Supplier name can't be blank." }, { status: 400 });
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    const { error } = await db.from("suppliers").update(update).eq("id", id);
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "supplier_edit",
      summary: `${email} edited supplier "${existing.name}"`,
      detail: { supplier_id: id, fields: Object.keys(update) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/** DELETE /api/suppliers/:id -- remove a directory entry (doesn't touch
 *  any canvassing/PO rows that reference the supplier by name -- this is
 *  just the reference list). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad supplier id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["supplier-directory"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to remove suppliers." }, { status: 403 });
    }

    const { data: existing } = await db.from("suppliers").select("id, name").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Supplier not found." }, { status: 404 });

    const { error } = await db.from("suppliers").delete().eq("id", id);
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "supplier_delete",
      summary: `${email} removed supplier "${existing.name}" from the directory`,
      detail: { supplier_id: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
