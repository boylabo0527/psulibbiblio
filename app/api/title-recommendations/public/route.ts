import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBMITTER_ROLES = ["Faculty", "Student", "Staff", "Other"];

type TitleInput = {
  title?: string; author?: string; publisher?: string; year?: string; isbn?: string;
  format_preference?: string; notes?: string; price_estimate?: number | null;
};

type PublicTitleInput = {
  subject_id?: number;
  titles?: TitleInput[];
  campus?: string;
  submitter_role?: string; submitter_name?: string; submitter_email?: string;
  /** Honeypot -- a real visitor never sees or fills this field (hidden via
   *  CSS in PublicSuggestTitleTab.tsx), so anything in it means a bot
   *  filled every input it found. A non-empty value gets a fake success
   *  response instead of an error, so the bot has no signal to adapt to. */
  website?: string;
};

/** POST /api/title-recommendations/public -- lets anyone suggest a title
 *  without signing in, explicitly allowed through middleware.ts's normal
 *  auth requirement (see PUBLIC_API_POST_EXACT there). Feeds the exact
 *  same `title_recommendations` pending-review queue Market Canvassing
 *  staff already work from (see /api/title-recommendations) -- an
 *  anonymous submission can't be tied to a real account, so
 *  recommended_by is just whatever the submitter typed, and
 *  submitted_publicly marks it so reviewers know that. subject_id comes
 *  from the same public /api/dashboard/subjects list the Dashboard tab
 *  already exposes to anonymous visitors -- not a secret, so the form can
 *  send it directly instead of re-resolving a program/course-code pair.
 *  Body: { subject_id, titles, campus, submitter_role, submitter_name?,
 *  submitter_email? }, titles: [{ title, author?, publisher?, year?, isbn?,
 *  format_preference?, notes?, price_estimate? }, ...] -- mirrors POST
 *  /api/title-recommendations so one course visit can suggest several
 *  books at once. submitter_role must be one of SUBMITTER_ROLES; campus
 *  must name a real row in the `campuses` table -- a course is offered
 *  the same everywhere, so which campus's shortage this addresses can't
 *  be inferred from subject_id alone. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const body = await req.json() as PublicTitleInput;

    if ((body.website ?? "").trim()) {
      // Honeypot tripped -- pretend it worked, insert nothing.
      return NextResponse.json({ ok: true });
    }

    const subjectId = Number(body.subject_id);
    const inputs = (body.titles ?? []).filter((t) => (t.title ?? "").trim());
    const submitterRole = SUBMITTER_ROLES.includes(body.submitter_role ?? "") ? (body.submitter_role as string) : "";
    const campus = (body.campus ?? "").trim();
    if (!Number.isFinite(subjectId) || !inputs.length || !submitterRole || !campus) {
      return NextResponse.json({ error: "Campus, Course, at least one Title, and 'I am a' are required." }, { status: 400 });
    }

    const [{ data: subject }, { data: campusRow }] = await Promise.all([
      db.from("subjects").select("id").eq("id", subjectId).maybeSingle(),
      db.from("campuses").select("id").eq("name", campus).maybeSingle(),
    ]);
    if (!subject) return NextResponse.json({ error: "That course couldn't be found -- reload the page and try again." }, { status: 404 });
    if (!campusRow) return NextResponse.json({ error: "That campus couldn't be found -- reload the page and try again." }, { status: 404 });

    const submitterName = (body.submitter_name ?? "").trim();
    const submitterEmail = (body.submitter_email ?? "").trim();
    const recommendedBy = [submitterName, submitterEmail && `(${submitterEmail})`].filter(Boolean).join(" ") || "Anonymous (public submission)";

    const insertRows = inputs.map((t) => {
      const priceEstimate = Number(t.price_estimate);
      return {
        subject_id: subject.id, recommended_by: recommendedBy, title: (t.title ?? "").trim(),
        author: (t.author ?? "").trim(), publisher: (t.publisher ?? "").trim(),
        year: (t.year ?? "").trim(), isbn: (t.isbn ?? "").trim(),
        format_preference: (t.format_preference ?? "").trim(), notes: (t.notes ?? "").trim(),
        price_estimate: Number.isFinite(priceEstimate) ? priceEstimate : null,
        submitted_publicly: true, submitter_role: submitterRole, campus,
      };
    });
    const { data: inserted, error } = await db.from("title_recommendations").insert(insertRows).select("id");
    if (error) throw error;

    await logActivity(db, {
      action: "title_recommendation_submit",
      summary: inputs.length === 1
        ? `${recommendedBy} (${submitterRole}, ${campus}) publicly suggested "${insertRows[0].title}"`
        : `${recommendedBy} (${submitterRole}, ${campus}) publicly suggested ${inputs.length} titles: ${insertRows.map((r) => `"${r.title}"`).join(", ")}`,
      detail: { recommendation_ids: (inserted ?? []).map((d) => d.id), subject_id: subject.id, public: true, submitter_role: submitterRole, campus },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
