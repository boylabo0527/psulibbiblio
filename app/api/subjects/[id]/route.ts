import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid subject id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      course_code?: string;
      course_title?: string;
      description?: string;
    };
    const patch: Record<string, string> = {};
    if (typeof body.course_code === "string") patch.course_code = body.course_code.trim();
    if (typeof body.course_title === "string") patch.course_title = body.course_title.trim();
    if (typeof body.description === "string") patch.description = body.description.trim();
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }
    if ("course_title" in patch && !patch.course_title) {
      return NextResponse.json({ error: "Course title cannot be empty" }, { status: 400 });
    }
    const db = serviceClient();
    const { data, error } = await db
      .from("subjects")
      .update(patch)
      .eq("id", id)
      .select("id, course_code, course_title, description")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, subject: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
