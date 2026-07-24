import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SupplierOfferRow = {
  id: number;
  subject_id: number | null;
  supplier_email: string;
  title: string;
  author: string;
  format: string;
  price: number | null;
  notes: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  decided_at: string | null;
  decided_by: string;
  subject_label?: string;
};

/** GET /api/supplier/offers -- suppliers see only their own submissions;
 *  anyone who can view Market Canvassing (or an admin) sees all, for
 *  review. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    const isReviewer = perms.isAdmin || !!perms.tabs["canvassing"]?.can_view;

    if (!isReviewer && !perms.tabs["supplier-view"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    let q = db.from("supplier_offers").select("*").order("created_at", { ascending: false });
    if (!isReviewer) q = q.eq("supplier_email", email);
    const { data, error } = await q;
    if (error) throw error;

    const subjectIds = Array.from(new Set((data ?? []).map((o) => o.subject_id).filter((id): id is number => id != null)));
    const labelMap = new Map<number, string>();
    if (subjectIds.length) {
      const { data: subs } = await db.from("subjects").select("id, course_code, course_title").in("id", subjectIds);
      for (const s of subs ?? []) labelMap.set(s.id, [s.course_code, s.course_title].filter(Boolean).join(" — "));
    }

    const rows: SupplierOfferRow[] = (data ?? []).map((o) => ({
      ...o,
      subject_label: o.subject_id != null ? labelMap.get(o.subject_id) ?? "" : "",
    }));
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** POST /api/supplier/offers -- a supplier offers a title against a need.
 *  Body: { subject_id, title, author, format, price, notes }. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["supplier-view"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to submit offers." }, { status: 403 });
    }
    const body = await req.json() as {
      subject_id?: number; title?: string; author?: string; format?: string; price?: number; notes?: string;
    };
    const title = (body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

    const { data, error } = await db.from("supplier_offers").insert({
      subject_id: body.subject_id ?? null,
      supplier_email: email,
      title,
      author: (body.author ?? "").trim(),
      format: (body.format ?? "").trim(),
      price: body.price ?? null,
      notes: (body.notes ?? "").trim(),
    }).select().single();
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "supplier_offer_submit",
      summary: `${email} offered "${title}"${body.price ? ` at ${body.price}` : ""}`,
      detail: { offer_id: data.id, subject_id: body.subject_id ?? null },
    });
    return NextResponse.json({ offer: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
