import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/supplier/offers/:id -- accept or decline a submitted offer.
 *  Body: { status: "accepted" | "declined" }. Requires Market Canvassing
 *  edit access (or admin) -- reviewing supplier quotes is a canvassing
 *  action. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad offer id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to review offers." }, { status: 403 });
    }

    const body = await req.json() as { status?: string };
    if (body.status !== "accepted" && body.status !== "declined") {
      return NextResponse.json({ error: "status must be 'accepted' or 'declined'" }, { status: 400 });
    }

    const { data, error } = await db.from("supplier_offers")
      .update({ status: body.status, decided_at: new Date().toISOString(), decided_by: email })
      .eq("id", id).select().single();
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "supplier_offer_decide",
      summary: `${body.status === "accepted" ? "Accepted" : "Declined"} offer "${data.title}" from ${data.supplier_email}`,
      detail: { offer_id: id, status: body.status },
    });
    return NextResponse.json({ offer: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
