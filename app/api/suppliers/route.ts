import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SupplierRow = {
  id: number;
  name: string;
  address: string;
  contact_person: string;
  phone: string;
  email: string;
  tin: string;
  notes: string;
  created_by: string;
  created_at: string;
};

/** GET /api/suppliers -- the supplier directory, alphabetical. Not
 *  campus-scoped -- a supplier isn't tied to one campus, and everyone who
 *  can see it needs the same coordination info regardless of their own
 *  campus restriction. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["supplier-directory"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    const { data, error } = await db.from("suppliers").select("*").order("name");
    if (error) throw error;
    return NextResponse.json({ rows: (data ?? []) as SupplierRow[] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

type SupplierInput = { name?: string; address?: string; contact_person?: string; phone?: string; email?: string; tin?: string; notes?: string };

/** POST /api/suppliers -- add a supplier to the directory. Body:
 *  { name, address?, contact_person?, phone?, email?, tin?, notes? }. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["supplier-directory"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to add suppliers." }, { status: 403 });
    }
    const body = await req.json() as SupplierInput;
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Supplier name is required." }, { status: 400 });

    const { data: dupe } = await db.from("suppliers").select("id").ilike("name", name).maybeSingle();
    if (dupe) return NextResponse.json({ error: `"${name}" is already in the directory.` }, { status: 409 });

    const { data, error } = await db.from("suppliers").insert({
      name, address: (body.address ?? "").trim(), contact_person: (body.contact_person ?? "").trim(),
      phone: (body.phone ?? "").trim(), email: (body.email ?? "").trim(), tin: (body.tin ?? "").trim(),
      notes: (body.notes ?? "").trim(), created_by: email,
    }).select("id").single();
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "supplier_create",
      summary: `${email} added supplier "${name}" to the directory`,
      detail: { supplier_id: data?.id },
    });
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
