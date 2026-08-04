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

/** GET /api/admin/pr-workflow -- the ordered list of offices a Purchase
 *  Request passes through. Public to any signed-in user who can at least
 *  view Monitoring or Purchase Request (they need the labels to make
 *  sense of a PR's current step), not admin-only like the mutations below. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view && !perms.tabs["purchase-request"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    const { data, error } = await db.from("pr_workflow_steps").select("id, seq, office_name").order("seq");
    if (error) throw error;
    return NextResponse.json({ steps: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** POST /api/admin/pr-workflow -- append a new office to the end of the
 *  sequence. Body: { office_name }. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = await requireAdmin(req, db);
    const body = await req.json() as { office_name?: string };
    const officeName = (body.office_name ?? "").trim();
    if (!officeName) return NextResponse.json({ error: "Office name is required." }, { status: 400 });

    const { data: maxRow } = await db.from("pr_workflow_steps").select("seq").order("seq", { ascending: false }).limit(1).maybeSingle();
    const nextSeq = (maxRow?.seq ?? 0) + 1;

    const { data, error } = await db.from("pr_workflow_steps").insert({ seq: nextSeq, office_name: officeName }).select("id, seq, office_name").single();
    if (error) throw error;
    await logActivity(db, { userEmail: email, action: "pr_workflow_step_create", summary: `Added PR workflow office "${officeName}" (step ${nextSeq})`, detail: { id: data.id, seq: nextSeq } });
    return NextResponse.json({ step: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** PATCH /api/admin/pr-workflow -- rename a step, or swap its position with
 *  an adjacent step (reorder). Body: either { id, office_name } to rename,
 *  or { id, swap_with_id } to swap two steps' seq values. */
export async function PATCH(req: Request) {
  try {
    const db = serviceClient();
    const email = await requireAdmin(req, db);
    const body = await req.json() as { id?: number; office_name?: string; swap_with_id?: number };
    const id = body.id;
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (body.swap_with_id != null) {
      const [{ data: a }, { data: b }] = await Promise.all([
        db.from("pr_workflow_steps").select("id, seq, office_name").eq("id", id as number).maybeSingle(),
        db.from("pr_workflow_steps").select("id, seq, office_name").eq("id", body.swap_with_id).maybeSingle(),
      ]);
      if (!a || !b) return NextResponse.json({ error: "Step not found" }, { status: 404 });
      // Swap via a temporary seq to dodge the unique constraint mid-update.
      await db.from("pr_workflow_steps").update({ seq: -1 }).eq("id", a.id);
      await db.from("pr_workflow_steps").update({ seq: a.seq }).eq("id", b.id);
      const { error } = await db.from("pr_workflow_steps").update({ seq: b.seq }).eq("id", a.id);
      if (error) throw error;
      await logActivity(db, { userEmail: email, action: "pr_workflow_step_edit", summary: `Reordered PR workflow: "${a.office_name}" <-> "${b.office_name}"`, detail: { a: a.id, b: b.id } });
      return NextResponse.json({ ok: true });
    }

    const officeName = (body.office_name ?? "").trim();
    if (!officeName) return NextResponse.json({ error: "office_name is required" }, { status: 400 });
    const { error } = await db.from("pr_workflow_steps").update({ office_name: officeName }).eq("id", id as number);
    if (error) throw error;
    await logActivity(db, { userEmail: email, action: "pr_workflow_step_edit", summary: `Renamed PR workflow office to "${officeName}"`, detail: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** DELETE /api/admin/pr-workflow?id=... -- remove an office from the
 *  sequence. Purchase Requests currently sitting at this step keep their
 *  current_step_seq as-is (their step label just won't resolve to a name
 *  anymore) rather than being silently reassigned -- an admin removing a
 *  step should notice and fix any PRs stuck there, not have them jump. */
export async function DELETE(req: Request) {
  try {
    const db = serviceClient();
    const email = await requireAdmin(req, db);
    const id = parseInt(new URL(req.url).searchParams.get("id") ?? "", 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad step id" }, { status: 400 });

    const { data: step } = await db.from("pr_workflow_steps").select("id, office_name").eq("id", id).maybeSingle();
    if (!step) return NextResponse.json({ error: "Step not found" }, { status: 404 });

    const { error } = await db.from("pr_workflow_steps").delete().eq("id", id);
    if (error) throw error;
    await logActivity(db, { userEmail: email, action: "pr_workflow_step_delete", summary: `Removed PR workflow office "${step.office_name}"`, detail: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}
