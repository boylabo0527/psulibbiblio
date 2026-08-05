import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isCampusInScope } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import type { PersistedPRItem } from "@/lib/purchase-request-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/purchase-request/:id -- full row including line items, for the
 *  Monitoring "Edit" panel to load before showing the form. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase request id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view && !perms.tabs["purchase-request"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const { data, error } = await db.from("purchase_requests").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Purchase request not found." }, { status: 404 });
    if (!isCampusInScope(perms, data.campus_id)) {
      return NextResponse.json({ error: "This purchase request isn't in your assigned campus(es)." }, { status: 403 });
    }
    return NextResponse.json({ pr: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type PatchBody = {
  pr_no?: string; office?: string; purpose?: string; requested_by?: string; approved_by?: string;
  items?: { quantity: number; unit_cost: number }[]; // positional -- same length/order as the stored items
};

/** PATCH /api/purchase-request/:id -- edit header fields and/or each line
 *  item's quantity/unit cost (not which titles are on it -- adding or
 *  removing a title is a new PR, not an edit of this one). Blocked once
 *  the PR is completed or cancelled. Gated the same as the rest of
 *  Monitoring's PR actions (advance/status, cancel). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase request id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to modify purchase requests." }, { status: 403 });
    }

    const { data: pr, error: prErr } = await db.from("purchase_requests").select("id, pr_no, items, status, campus_id").eq("id", id).maybeSingle();
    if (prErr) throw prErr;
    if (!pr) return NextResponse.json({ error: "Purchase request not found." }, { status: 404 });
    if (!isCampusInScope(perms, pr.campus_id)) {
      return NextResponse.json({ error: "This purchase request isn't in your assigned campus(es)." }, { status: 403 });
    }
    if (pr.status !== "in_progress") {
      return NextResponse.json({ error: `Can't modify a purchase request that's ${pr.status}.` }, { status: 400 });
    }

    const body: PatchBody = await req.json();
    const update: Record<string, unknown> = {};
    if (body.pr_no !== undefined) update.pr_no = body.pr_no.trim();
    if (body.office !== undefined) update.office = body.office;
    if (body.purpose !== undefined) update.purpose = body.purpose;
    if (body.requested_by !== undefined) update.requested_by = body.requested_by;
    if (body.approved_by !== undefined) update.approved_by = body.approved_by;

    if (body.pr_no !== undefined && body.pr_no.trim()) {
      const { data: dupe } = await db.from("purchase_requests")
        .select("id").eq("pr_no", body.pr_no.trim()).neq("status", "cancelled").neq("id", id).maybeSingle();
      if (dupe) return NextResponse.json({ error: `PR No. "${body.pr_no.trim()}" is already used by another active purchase request.` }, { status: 409 });
    }

    let totalAmount: number | undefined;
    if (body.items) {
      const existing = (Array.isArray(pr.items) ? pr.items : []) as PersistedPRItem[];
      if (body.items.length !== existing.length) {
        return NextResponse.json({ error: "Item count mismatch -- reload this purchase request and try again." }, { status: 400 });
      }
      const merged: PersistedPRItem[] = existing.map((item, i) => ({
        ...item,
        quantity: Math.max(1, Number(body.items![i].quantity) || 1),
        unit_cost: Math.max(0, Number(body.items![i].unit_cost) || 0),
      }));
      update.items = merged;
      totalAmount = merged.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
      update.total_amount = totalAmount;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { error: updErr } = await db.from("purchase_requests").update(update).eq("id", id);
    if (updErr) throw updErr;

    await logActivity(db, {
      userEmail: email, action: "purchase_request_edit",
      summary: `${email} edited purchase request ${pr.pr_no || "(draft)"}`,
      detail: { purchase_request_id: id, fields: Object.keys(update) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** DELETE /api/purchase-request/:id -- permanently remove a purchase
 *  request. Restricted to already-cancelled ones: an in-progress or
 *  completed PR is a real procurement record and should be cancelled (kept,
 *  audit-visible) rather than erased; this exists so a cancelled PR that
 *  was a mistake or a duplicate doesn't have to sit in the list forever.
 *  Admin-only, same bar as deleting any other record in this app. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad purchase request id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin) return NextResponse.json({ error: "Only an admin can delete a purchase request." }, { status: 403 });

    const { data: pr, error: prErr } = await db.from("purchase_requests").select("id, pr_no, status").eq("id", id).maybeSingle();
    if (prErr) throw prErr;
    if (!pr) return NextResponse.json({ error: "Purchase request not found." }, { status: 404 });
    if (pr.status !== "cancelled") {
      return NextResponse.json({ error: "Only a cancelled purchase request can be deleted." }, { status: 400 });
    }

    const { error: delErr } = await db.from("purchase_requests").delete().eq("id", id);
    if (delErr) throw delErr;

    await logActivity(db, {
      userEmail: email, action: "purchase_request_delete",
      summary: `${email} deleted cancelled purchase request ${pr.pr_no || "(draft)"}`,
      detail: { purchase_request_id: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
