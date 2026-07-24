import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/subjects — manually add a single course under a program. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to add courses." }, { status: 403 });
    }
    const body = await req.json() as { program_id?: number; course_code?: string; course_title?: string; description?: string };
    const programId = body.program_id;
    const courseCode = (body.course_code ?? "").trim();
    const courseTitle = (body.course_title ?? "").trim();
    if (!Number.isFinite(programId)) {
      return NextResponse.json({ error: "program_id is required" }, { status: 400 });
    }
    if (!courseCode && !courseTitle) {
      return NextResponse.json({ error: "Course code or title is required" }, { status: 400 });
    }

    const { data: maxRow } = await db.from("subjects")
      .select("sort_order").eq("program_id", programId as number)
      .order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const nextOrder = (maxRow?.sort_order ?? -1) + 1;

    const { data, error } = await db.from("subjects").insert({
      program_id: programId,
      course_code: courseCode,
      course_title: courseTitle || courseCode,
      description: (body.description ?? "").trim(),
      sort_order: nextOrder,
    }).select().single();
    if (error) throw error;
    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: "subject_create",
      summary: `Added course "${courseCode || courseTitle}" manually`,
      detail: { subject_id: data.id, program_id: programId, course_code: courseCode, course_title: courseTitle },
    });
    return NextResponse.json({ subject: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
