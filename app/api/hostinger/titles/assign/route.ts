import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { hostingerEnabled, getPerlegoTitleById, deletePerlegoTitleById } from "@/lib/hostinger-mysql";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/hostinger/titles/assign -- copies an archived Perlego title
 *  back into the main catalog and assigns it straight to a course, instead
 *  of the old two-step "re-upload the Perlego export, then match it"
 *  workflow. Body: { hostinger_id, subject_id }. Admin-only, same as
 *  searching the Hostinger archive (org-wide database credentials, not a
 *  per-tab permission). Once copied over, the archived row is removed --
 *  it's a normal catalog title now, not both at once. */
export async function POST(req: Request) {
  const db = serviceClient();
  const email = userEmailFromRequest(req);
  const perms = await getUserPermissions(db, email);
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can add a title from the Perlego archive." }, { status: 403 });
  }
  if (!hostingerEnabled()) {
    return NextResponse.json({ error: "Hostinger isn't configured." }, { status: 400 });
  }

  try {
    const body = await req.json() as { hostinger_id?: number; subject_id?: number };
    const hostingerId = Number(body.hostinger_id);
    const subjectId = Number(body.subject_id);
    if (!Number.isFinite(hostingerId) || !Number.isFinite(subjectId)) {
      return NextResponse.json({ error: "hostinger_id and subject_id are required." }, { status: 400 });
    }

    const [archived, { data: subject }] = await Promise.all([
      getPerlegoTitleById(hostingerId),
      db.from("subjects").select("id, course_code, course_title").eq("id", subjectId).maybeSingle(),
    ]);
    if (!archived) return NextResponse.json({ error: "That archived title wasn't found -- it may already have been added." }, { status: 404 });
    if (!subject) return NextResponse.json({ error: "Course not found." }, { status: 404 });

    const { data: title, error: titleErr } = await db.from("titles").insert({
      format: "ebook_paid",
      title: archived.title,
      author: archived.author ?? "",
      publisher: archived.publisher ?? "",
      year: archived.year ?? "",
      isbn: archived.isbn ?? "",
      url: archived.url ?? "",
      provider: archived.provider ?? "",
    }).select("id").single();
    if (titleErr) throw titleErr;

    const { error: assignErr } = await db.from("assignments").upsert(
      { subject_id: subjectId, title_id: title.id, score: 1, rank: 0, explanation: "From Perlego archive", manual: 1 },
      { onConflict: "subject_id,title_id" },
    );
    if (assignErr) throw assignErr;

    await deletePerlegoTitleById(hostingerId);

    await logActivity(db, {
      userEmail: email, action: "assignment_add",
      summary: `${email} added "${archived.title}" from the Perlego archive to "${subject.course_code || subject.course_title}"`,
      detail: { subject_id: subjectId, title_id: title.id, hostinger_id: hostingerId },
    });
    return NextResponse.json({ ok: true, title_id: title.id });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
