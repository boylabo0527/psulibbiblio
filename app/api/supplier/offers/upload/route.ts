import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadRow = {
  course_code?: string;
  title?: string;
  author?: string;
  format?: string;
  price?: number | string;
  notes?: string;
};

const norm = (s: string) => s.trim().toLowerCase();

/** POST /api/supplier/offers/upload -- a supplier uploads a whole file
 *  (parsed to rows in the browser, same way other uploads in this app
 *  work) listing titles they can offer, matched to subjects by course
 *  code -- so several titles for several different needs can be submitted
 *  in one file instead of one form submission per title. Body:
 *  { rows: [{ course_code, title, author, format, price, notes }, ...] }.
 *
 *  Row layout matches the "Titles We Need" CSV export: a supplier
 *  downloads that, fills in Offer Title/Author/Format/Price/Notes on
 *  whichever rows they can supply (adding extra rows with the same course
 *  code to offer more than one title for that need), and uploads it back. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["supplier-view"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to submit offers." }, { status: 403 });
    }

    const body = await req.json() as { rows?: UploadRow[] };
    const rows = body.rows ?? [];
    const candidates = rows
      .map((r, i) => ({ ...r, _line: i + 2 })) // +2: header row + 1-indexing, for user-facing messages
      .filter((r) => (r.course_code ?? "").trim() && (r.title ?? "").trim());
    if (!candidates.length) {
      return NextResponse.json({ error: "No rows with both a course code and a title to offer were found." }, { status: 400 });
    }

    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;

    const codes = Array.from(new Set(candidates.map((r) => norm(r.course_code!))));
    const { data: subjectRows, error: subjErr } = await db.from("subjects")
      .select("id, program_id, course_code").in("course_code", rows.map((r) => (r.course_code ?? "").trim()).filter(Boolean));
    if (subjErr) throw subjErr;

    const byCode = new Map<string, { id: number; program_id: number }[]>();
    for (const s of subjectRows ?? []) {
      const key = norm(s.course_code ?? "");
      if (!codes.includes(key)) continue;
      if (allowedProgramIds && !allowedProgramIds.has(s.program_id)) continue;
      if (!byCode.has(key)) byCode.set(key, []);
      byCode.get(key)!.push({ id: s.id, program_id: s.program_id });
    }

    const batchId = randomUUID();
    const insertRows: { subject_id: number; supplier_email: string; title: string; author: string; format: string; price: number | null; notes: string; batch_id: string }[] = [];
    const problems: { line: number; course_code: string; reason: string }[] = [];

    for (const r of candidates) {
      const key = norm(r.course_code!);
      const matches = byCode.get(key) ?? [];
      if (matches.length === 0) {
        problems.push({ line: r._line, course_code: r.course_code!, reason: "Course code not found (or not in one of your assigned campuses)." });
        continue;
      }
      if (matches.length > 1) {
        problems.push({ line: r._line, course_code: r.course_code!, reason: "Course code matches more than one program -- couldn't tell which one you meant." });
        continue;
      }
      const price = typeof r.price === "number" ? r.price : parseFloat(String(r.price ?? "").replace(/[^0-9.]/g, ""));
      insertRows.push({
        subject_id: matches[0].id,
        supplier_email: email,
        title: r.title!.trim(),
        author: (r.author ?? "").trim(),
        format: (r.format ?? "").trim(),
        price: Number.isFinite(price) ? price : null,
        notes: (r.notes ?? "").trim(),
        batch_id: batchId,
      });
    }

    if (!insertRows.length) {
      return NextResponse.json({ inserted: 0, problems }, { status: 200 });
    }

    const { data, error } = await db.from("supplier_offers").insert(insertRows).select();
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "supplier_offer_submit",
      summary: `${email} uploaded ${insertRows.length} title offer${insertRows.length === 1 ? "" : "s"} across ${new Set(insertRows.map((r) => r.subject_id)).size} subject(s)${problems.length ? ` (${problems.length} row${problems.length === 1 ? "" : "s"} skipped)` : ""}`,
      detail: { offer_ids: (data ?? []).map((d) => d.id), batch_id: batchId, problems },
    });
    return NextResponse.json({ inserted: data?.length ?? 0, problems });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
