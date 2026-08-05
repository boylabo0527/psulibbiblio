import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds, isProgramInScope } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type StandardTitleRow = {
  id: number;
  subject_id: number;
  course_code: string;
  course_title: string;
  program_id: number | null;
  program: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  isbn: string;
  notes: string;
  created_by: string;
  created_at: string;
};

/** GET /api/standard-titles -- every standard title the library committee
 *  has set, with its course/program for display. Optional ?subject_id= to
 *  scope to one course. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["standard-titles"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const u = new URL(req.url);
    const subjectId = u.searchParams.get("subject_id");

    let q = db.from("standard_titles")
      .select("*, subjects(course_code, course_title, program_id)")
      .order("subject_id").order("title");
    if (subjectId) q = q.eq("subject_id", Number(subjectId));

    const { data: rawData, error } = await q;
    if (error) throw error;

    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;
    const data = allowedProgramIds
      ? (rawData ?? []).filter((r) => {
          const pid = (r.subjects as unknown as { program_id?: number } | null)?.program_id;
          return pid == null || allowedProgramIds.has(pid);
        })
      : rawData;

    const programIds = Array.from(new Set((data ?? [])
      .map((r) => (r.subjects as unknown as { program_id?: number } | null)?.program_id)
      .filter((id): id is number => id != null)));
    const programNameById = new Map<number, string>();
    if (programIds.length) {
      const { data: progs } = await db.from("programs").select("id, name").in("id", programIds);
      for (const p of progs ?? []) programNameById.set(p.id, p.name);
    }

    const rows: StandardTitleRow[] = (data ?? []).map((r) => {
      const sub = r.subjects as unknown as { course_code?: string; course_title?: string; program_id?: number } | null;
      return {
        id: r.id, subject_id: r.subject_id,
        course_code: sub?.course_code ?? "", course_title: sub?.course_title ?? "",
        program_id: sub?.program_id ?? null,
        program: sub?.program_id != null ? (programNameById.get(sub.program_id) ?? "") : "",
        title: r.title, author: r.author, publisher: r.publisher, year: r.year, isbn: r.isbn,
        notes: r.notes, created_by: r.created_by, created_at: r.created_at,
      };
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/** DELETE /api/standard-titles?id=... -- remove one standard title (typo
 *  fix, superseded edition, etc.) without needing to redo the whole bulk
 *  upload. */
export async function DELETE(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["standard-titles"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to remove standard titles." }, { status: 403 });
    }
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { data: existing } = await db.from("standard_titles").select("id, title, subjects(program_id)").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const existingProgramId = (existing.subjects as unknown as { program_id?: number } | null)?.program_id ?? null;
    if (!(await isProgramInScope(db, perms, existingProgramId))) {
      return NextResponse.json({ error: "This entry isn't in your assigned campus(es)." }, { status: 403 });
    }

    const { error } = await db.from("standard_titles").delete().eq("id", id);
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "standard_title_delete",
      summary: `${email} removed standard title "${existing.title}"`,
      detail: { standard_title_id: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
