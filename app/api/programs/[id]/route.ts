import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/programs/:id — rename a program (Campus Validation tab)
 *  and/or set its default cost-per-title procurement estimate
 *  (Procurement Analysis tab) -- gated separately since either field can
 *  be sent independently by either tab's UI. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad program id" }, { status: 400 });
    }
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    const body = await req.json() as { name?: string; cost_per_title?: number | null };
    const patch: Record<string, unknown> = {};
    let name: string | undefined;
    if ("name" in body) {
      if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
        return NextResponse.json({ error: "Your account doesn't have permission to rename programs." }, { status: 403 });
      }
      name = (body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "Program name is required." }, { status: 400 });
      patch.name = name;
    }
    if ("cost_per_title" in body) {
      if (!perms.isAdmin && !perms.tabs["procurement"]?.can_edit) {
        return NextResponse.json({ error: "Your account doesn't have permission to set cost estimates." }, { status: 403 });
      }
      patch.cost_per_title = body.cost_per_title;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const { data: before } = await db.from("programs").select("name, cost_per_title").eq("id", id).maybeSingle();
    const { data, error } = await db.from("programs").update(patch).eq("id", id).select("id, name, cost_per_title").single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `A program named "${name}" already exists.` }, { status: 409 });
      }
      throw error;
    }
    const userEmail = userEmailFromRequest(req);
    if (name) {
      await logActivity(db, {
        userEmail, action: "program_rename",
        summary: `Renamed program "${before?.name ?? "?"}" to "${name}"`,
        detail: { program_id: id, old_name: before?.name ?? null, new_name: name },
      });
    }
    if ("cost_per_title" in patch) {
      await logActivity(db, {
        userEmail, action: "program_cost_estimate",
        summary: `Set default cost per title for "${data.name}" to ${patch.cost_per_title ?? "unset"}`,
        detail: { program_id: id, cost_per_title: patch.cost_per_title },
      });
    }
    return NextResponse.json({ program: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** DELETE /api/programs/:id — remove a program.
 *  Refuses if the program still has subjects, so a duplicate/mistaken
 *  program can be deleted safely without silently losing curriculum data;
 *  the caller must delete/move those subjects first. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad program id" }, { status: 400 });
    }
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to delete programs." }, { status: 403 });
    }

    const { count, error: countErr } = await db.from("subjects")
      .select("id", { count: "exact", head: true }).eq("program_id", id);
    if (countErr) throw countErr;
    if (count && count > 0) {
      return NextResponse.json(
        { error: `This program still has ${count} subject(s). Remove or reassign them before deleting the program.` },
        { status: 409 },
      );
    }

    const { data: before } = await db.from("programs").select("name").eq("id", id).maybeSingle();
    const { error } = await db.from("programs").delete().eq("id", id);
    if (error) throw error;
    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: "program_delete",
      summary: `Deleted program "${before?.name ?? "?"}"`,
      detail: { program_id: id, name: before?.name ?? null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
