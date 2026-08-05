import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds, isProgramInScope } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdditionalSubject = { subject_id: number; course_code: string; course_title: string; program: string; college: string };

export type CanvassingRow = {
  id: number;
  title: string;
  author: string;
  publisher: string;
  year: string;
  isbn: string;
  subject_id: number | null;
  subject_label: string;
  program_id: number | null;
  program: string;
  /** The primary program's college (e.g. "College of Nursing"), if one is
   *  set -- lets faculty browsing canvassed titles group/filter by their
   *  own college instead of scanning every program's titles. */
  college: string;
  supplier: string;
  unit: string;
  stock_prop_no: string;
  unit_cost: number;
  quantity: number;
  canvass_date: string;
  notes: string;
  created_at: string;
  /** Other courses (besides the primary subject_id above) this same title
   *  also counts toward -- e.g. a general-education ebook relevant to
   *  several subjects. See /api/canvassing/link-subject. */
  additional_subjects: AdditionalSubject[];
};

export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_view && !perms.tabs["faculty-recommendations"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;

    const u = new URL(req.url);
    const programId = u.searchParams.get("program_id");
    const subjectId = u.searchParams.get("subject_id");

    let q = db.from("canvassing")
      .select("*, subjects(course_code, course_title, program_id), programs(name, college)")
      .order("canvass_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (subjectId) q = q.eq("subject_id", Number(subjectId));
    else if (programId) q = q.eq("program_id", Number(programId));

    const { data: rawData, error } = await q;
    if (error) throw error;
    // Unassigned entries (no program yet) stay visible to every campus-
    // restricted canvassing editor -- they're the still-needs-triage queue,
    // and which campus one belongs to isn't knowable until it's assigned.
    const data = allowedProgramIds
      ? (rawData ?? []).filter((r) => r.program_id == null || allowedProgramIds.has(r.program_id as number))
      : rawData;

    const { data: programRows } = await db.from("programs").select("id, name, college");
    const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));
    const collegeMap = new Map((programRows ?? []).map((p: { id: number; college: string | null }) => [p.id, p.college ?? ""]));

    const ids = (data ?? []).map((r: Record<string, unknown>) => r.id as number);
    const additionalBySubject = new Map<number, AdditionalSubject[]>();
    if (ids.length) {
      const { data: links, error: linkErr } = await db.from("canvassing_subjects")
        .select("canvassing_id, subject_id, subjects(course_code, course_title, program_id)")
        .in("canvassing_id", ids);
      if (linkErr) throw linkErr;
      for (const l of (links ?? []) as { canvassing_id: number; subject_id: number; subjects: { course_code?: string; course_title?: string; program_id?: number } | null }[]) {
        const s = l.subjects;
        if (!additionalBySubject.has(l.canvassing_id)) additionalBySubject.set(l.canvassing_id, []);
        additionalBySubject.get(l.canvassing_id)!.push({
          subject_id: l.subject_id,
          course_code: s?.course_code ?? "",
          course_title: s?.course_title ?? "",
          program: s?.program_id != null ? (programMap.get(s.program_id) ?? "") : "",
          college: s?.program_id != null ? (collegeMap.get(s.program_id) ?? "") : "",
        });
      }
    }

    const rows: CanvassingRow[] = (data ?? []).map((r: Record<string, unknown>) => {
      const sub = r.subjects as { course_code?: string; course_title?: string } | null;
      const prog = r.programs as { name?: string; college?: string } | null;
      const primarySubjectId = r.subject_id as number | null;
      const additional = (additionalBySubject.get(r.id as number) ?? []).filter((a) => a.subject_id !== primarySubjectId);
      return {
        id: r.id as number,
        title: (r.title as string) ?? "",
        author: (r.author as string) ?? "",
        publisher: (r.publisher as string) ?? "",
        year: (r.year as string) ?? "",
        isbn: (r.isbn as string) ?? "",
        subject_id: primarySubjectId,
        subject_label: sub ? [sub.course_code, sub.course_title].filter(Boolean).join(" — ") : "",
        program_id: (r.program_id as number | null),
        program: prog?.name ?? "",
        college: prog?.college ?? "",
        supplier: (r.supplier as string) ?? "",
        unit: (r.unit as string) ?? "copy",
        stock_prop_no: (r.stock_prop_no as string) ?? "",
        unit_cost: Number(r.unit_cost ?? 0),
        quantity: Number(r.quantity ?? 1),
        canvass_date: (r.canvass_date as string) ?? "",
        notes: (r.notes as string) ?? "",
        created_at: (r.created_at as string) ?? "",
        additional_subjects: additional,
      };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}

/** PATCH /api/canvassing?id=... -- re-verify a canvassed price with the
 *  supplier: updates unit_cost and resets canvass_date to today (so the
 *  staleness badge clears), logging the old -> new price for an audit
 *  trail. Body: { unit_cost }. This is the integrity mechanism for prices
 *  that "usually change" -- rather than silently trusting an old quote,
 *  the UI flags it stale (see lib/pricing.ts) and this is how staff
 *  confirm/update it before it's used on a new Purchase Request. Titles
 *  already copied onto an existing PR/PO are unaffected -- those are
 *  frozen snapshots, by design. */
export async function PATCH(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to update canvassing records." }, { status: 403 });
    }
    const u = new URL(req.url);
    const id = Number(u.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const body = await req.json() as { unit_cost?: number };
    const newCost = Number(body.unit_cost);
    if (!Number.isFinite(newCost) || newCost < 0) {
      return NextResponse.json({ error: "A valid unit_cost is required." }, { status: 400 });
    }

    const { data: existing } = await db.from("canvassing").select("id, title, unit_cost, program_id").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Canvassing entry not found." }, { status: 404 });
    if (!(await isProgramInScope(db, perms, existing.program_id))) {
      return NextResponse.json({ error: "This entry isn't in your assigned campus(es)." }, { status: 403 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { error } = await db.from("canvassing").update({ unit_cost: newCost, canvass_date: today }).eq("id", id);
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "canvassing_price_reverify",
      summary: `${email} re-verified price for "${existing.title}": ${existing.unit_cost} -> ${newCost}`,
      detail: { canvassing_id: id, old_price: existing.unit_cost, new_price: newCost },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to delete canvassing records." }, { status: 403 });
    }
    const u = new URL(req.url);
    const id = Number(u.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { data: existing } = await db.from("canvassing").select("id, program_id").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Canvassing entry not found." }, { status: 404 });
    if (!(await isProgramInScope(db, perms, existing.program_id))) {
      return NextResponse.json({ error: "This entry isn't in your assigned campus(es)." }, { status: 403 });
    }
    const { error } = await db.from("canvassing").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
