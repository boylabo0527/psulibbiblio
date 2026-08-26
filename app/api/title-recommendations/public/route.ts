import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBMITTER_ROLES = ["Faculty", "Student", "Staff", "Other"];

type PublicTitleInput = {
  subject_id?: number;
  title?: string; author?: string; publisher?: string; year?: string; isbn?: string;
  format_preference?: string; notes?: string; price_estimate?: number | null;
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
 *  Body: { subject_id, title, submitter_role, author?, publisher?, year?,
 *  isbn?, format_preference?, notes?, price_estimate?, submitter_name?,
 *  submitter_email? }. submitter_role must be one of SUBMITTER_ROLES. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const body = await req.json() as PublicTitleInput;

    if ((body.website ?? "").trim()) {
      // Honeypot tripped -- pretend it worked, insert nothing.
      return NextResponse.json({ ok: true });
    }

    const subjectId = Number(body.subject_id);
    const title = (body.title ?? "").trim();
    const submitterRole = SUBMITTER_ROLES.includes(body.submitter_role ?? "") ? (body.submitter_role as string) : "";
    if (!Number.isFinite(subjectId) || !title || !submitterRole) {
      return NextResponse.json({ error: "Course, Title, and 'I am a' are required." }, { status: 400 });
    }

    const { data: subject } = await db.from("subjects").select("id").eq("id", subjectId).maybeSingle();
    if (!subject) return NextResponse.json({ error: "That course couldn't be found -- reload the page and try again." }, { status: 404 });

    const submitterName = (body.submitter_name ?? "").trim();
    const submitterEmail = (body.submitter_email ?? "").trim();
    const recommendedBy = [submitterName, submitterEmail && `(${submitterEmail})`].filter(Boolean).join(" ") || "Anonymous (public submission)";

    const priceEstimate = Number(body.price_estimate);
    const { data: inserted, error } = await db.from("title_recommendations").insert({
      subject_id: subject.id, recommended_by: recommendedBy, title,
      author: (body.author ?? "").trim(), publisher: (body.publisher ?? "").trim(),
      year: (body.year ?? "").trim(), isbn: (body.isbn ?? "").trim(),
      format_preference: (body.format_preference ?? "").trim(), notes: (body.notes ?? "").trim(),
      price_estimate: Number.isFinite(priceEstimate) ? priceEstimate : null,
      submitted_publicly: true, submitter_role: submitterRole,
    }).select("id").single();
    if (error) throw error;

    await logActivity(db, {
      action: "title_recommendation_submit",
      summary: `${recommendedBy} (${submitterRole}) publicly suggested "${title}"`,
      detail: { recommendation_id: inserted?.id, subject_id: subject.id, public: true, submitter_role: submitterRole },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
