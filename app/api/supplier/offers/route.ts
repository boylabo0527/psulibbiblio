import { randomUUID } from "crypto";
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
  batch_id: string | null;
  batch_size?: number;
  subject_label?: string;
  program?: string;
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
    const programBySubject = new Map<number, string>();
    if (subjectIds.length) {
      const { data: subs } = await db.from("subjects").select("id, course_code, course_title, program_id").in("id", subjectIds);
      const programIds = Array.from(new Set((subs ?? []).map((s) => s.program_id).filter((id): id is number => id != null)));
      const programNameById = new Map<number, string>();
      if (programIds.length) {
        const { data: progs } = await db.from("programs").select("id, name").in("id", programIds);
        for (const p of progs ?? []) programNameById.set(p.id, p.name);
      }
      for (const s of subs ?? []) {
        labelMap.set(s.id, [s.course_code, s.course_title].filter(Boolean).join(" — "));
        if (s.program_id != null) programBySubject.set(s.id, programNameById.get(s.program_id) ?? "");
      }
    }

    const batchSizes = new Map<string, number>();
    for (const o of data ?? []) {
      if (!o.batch_id) continue;
      batchSizes.set(o.batch_id, (batchSizes.get(o.batch_id) ?? 0) + 1);
    }
    const rows: SupplierOfferRow[] = (data ?? []).map((o) => ({
      ...o,
      subject_label: o.subject_id != null ? labelMap.get(o.subject_id) ?? "" : "",
      program: o.subject_id != null ? programBySubject.get(o.subject_id) ?? "" : "",
      batch_size: o.batch_id ? batchSizes.get(o.batch_id) : undefined,
    }));
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type OfferInput = { title?: string; author?: string; format?: string; price?: number; notes?: string };

/** POST /api/supplier/offers -- a supplier offers one or more titles against
 *  a need in one submission (e.g. a course short 3 titles). Body:
 *  { subject_id, offers: [{ title, author, format, price, notes }, ...] }.
 *  A single-title offer is just an `offers` array of length 1 -- there's no
 *  separate single-offer shape to keep in sync. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["supplier-view"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to submit offers." }, { status: 403 });
    }
    const body = await req.json() as { subject_id?: number; offers?: OfferInput[] };
    const inputs = (body.offers ?? []).filter((o) => (o.title ?? "").trim());
    if (!inputs.length) return NextResponse.json({ error: "At least one title is required." }, { status: 400 });

    const batchId = inputs.length > 1 ? randomUUID() : null;
    const insertRows = inputs.map((o) => ({
      subject_id: body.subject_id ?? null,
      supplier_email: email,
      title: (o.title ?? "").trim(),
      author: (o.author ?? "").trim(),
      format: (o.format ?? "").trim(),
      price: o.price ?? null,
      notes: (o.notes ?? "").trim(),
      batch_id: batchId,
    }));

    const { data, error } = await db.from("supplier_offers").insert(insertRows).select();
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "supplier_offer_submit",
      summary: inputs.length === 1
        ? `${email} offered "${insertRows[0].title}"${insertRows[0].price ? ` at ${insertRows[0].price}` : ""}`
        : `${email} offered ${inputs.length} titles${body.subject_id ? " for one subject" : ""}: ${inputs.map((o) => `"${o.title}"`).join(", ")}`,
      detail: { offer_ids: (data ?? []).map((d) => d.id), subject_id: body.subject_id ?? null, batch_id: batchId },
    });
    return NextResponse.json({ offers: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
