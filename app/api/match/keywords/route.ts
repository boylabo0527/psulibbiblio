import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isProgramInScope } from "@/lib/campus-scope";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MatchKeywordCourse = {
  subject_id: number;
  course_code: string;
  course_title: string;
  match_keyword: string;
};

export type MatchKeywordsResponse =
  | { courses: MatchKeywordCourse[] }
  | { error: string };

/** GET /api/match/keywords?program_id= -- every course in a program with
 *  its current match_keyword override (empty string if unset), for the
 *  Match tab's "Priority Keywords" panel. Same "match" tab permission as
 *  running Match itself, since this directly controls what a Match run
 *  searches for. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["match"]?.can_edit) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const programId = new URL(req.url).searchParams.get("program_id");
    if (!programId) return NextResponse.json({ courses: [] } satisfies MatchKeywordsResponse);

    if (!(await isProgramInScope(db, perms, Number(programId)))) {
      return NextResponse.json({ error: "That program is outside your assigned campuses." }, { status: 403 });
    }

    const { data, error } = await db
      .from("subjects")
      .select("id, course_code, course_title, match_keyword")
      .eq("program_id", Number(programId))
      .order("sort_order", { ascending: true });
    if (error) throw error;

    const courses: MatchKeywordCourse[] = (data ?? []).map((s) => ({
      subject_id: s.id,
      course_code: s.course_code ?? "",
      course_title: s.course_title ?? "",
      match_keyword: s.match_keyword ?? "",
    }));

    return NextResponse.json({ courses } satisfies MatchKeywordsResponse);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) } satisfies MatchKeywordsResponse, { status: 500 });
  }
}

/** PATCH /api/match/keywords { subject_id, match_keyword } -- sets or
 *  clears one course's matching override (empty string clears it, falling
 *  back to the normal title/description-based matching -- see
 *  lib/matcher.ts's subjectQueryTerms/subjectMustQuery/subjectText).
 *  Doesn't itself re-run matching; the admin still needs to Run Matching
 *  for this to actually change the course's assigned titles. */
export async function PATCH(req: Request) {
  try {
    const db = serviceClient();
    const userEmail = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, userEmail);
    if (!perms.isAdmin && !perms.tabs["match"]?.can_edit) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as { subject_id?: number; match_keyword?: string };
    const subjectId = body.subject_id;
    if (!subjectId) return NextResponse.json({ error: "Missing subject_id" }, { status: 400 });
    const matchKeyword = (body.match_keyword ?? "").trim();

    const { data: subjRow } = await db.from("subjects").select("id, program_id, course_code, course_title").eq("id", subjectId).maybeSingle();
    if (!subjRow) return NextResponse.json({ error: "Course not found." }, { status: 404 });
    if (!(await isProgramInScope(db, perms, subjRow.program_id))) {
      return NextResponse.json({ error: "That course is outside your assigned campuses." }, { status: 403 });
    }

    const { error } = await db.from("subjects").update({ match_keyword: matchKeyword }).eq("id", subjectId);
    if (error) throw error;

    await logActivity(db, {
      userEmail, action: "subject_edit",
      summary: matchKeyword
        ? `Set match keyword for ${subjRow.course_code ?? subjRow.course_title}: "${matchKeyword}"`
        : `Cleared match keyword for ${subjRow.course_code ?? subjRow.course_title}`,
      detail: { subject_id: subjectId, match_keyword: matchKeyword },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
