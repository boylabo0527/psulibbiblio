import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { parseYear } from "@/lib/years";
import { isResourceTypeId } from "@/lib/resources";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_SIZE = 10;

type Body = {
  table?: "titles" | "subjects" | "canvassing";
  dryRun?: boolean;
  format?: string;
  campus?: string;
  fromYear?: number;
  toYear?: number;
  search?: string;
  programId?: number;
  fromDate?: string;
  toDate?: string;
  supplier?: string;
};

type TitleRow = { id: number; title: string; author: string; format: string; campus: string; year: string; copies: number };
type SubjectRow = { id: number; course_code: string; course_title: string; program_id: number };
type CanvassingRow = { id: number; title: string; supplier: string; canvass_date: string; unit_cost: number };

const esc = (s: string) => s.replace(/[%,()]/g, "");

async function matchingTitles(db: ReturnType<typeof serviceClient>, body: Body): Promise<TitleRow[]> {
  const rows = await pageThrough<TitleRow>((from, to) => {
    let q = db.from("titles").select("id, title, author, format, campus, year, copies").range(from, to);
    if (body.format) q = q.eq("format", body.format);
    if (body.campus) q = q.eq("campus", body.campus);
    if (body.search) {
      const s = esc(body.search);
      q = q.or(`title.ilike.%${s}%,author.ilike.%${s}%,call_no.ilike.%${s}%,isbn.ilike.%${s}%`);
    }
    return q as unknown as PromiseLike<{ data: TitleRow[] | null; error: { message: string } | null }>;
  });
  const hasYearFilter = body.fromYear != null || body.toYear != null;
  if (!hasYearFilter) return rows;
  // A year filter is a targeting tool for deletion, so — unlike the report
  // filter — a row with no readable year does NOT match; we'd rather
  // under-delete than guess and remove something unintended.
  return rows.filter((r) => {
    const y = parseYear(r.year);
    if (y === null) return false;
    if (body.fromYear != null && y < body.fromYear) return false;
    if (body.toYear != null && y > body.toYear) return false;
    return true;
  });
}

async function matchingSubjects(db: ReturnType<typeof serviceClient>, body: Body): Promise<SubjectRow[]> {
  return pageThrough<SubjectRow>((from, to) => {
    let q = db.from("subjects").select("id, course_code, course_title, program_id").range(from, to);
    if (body.programId) q = q.eq("program_id", body.programId);
    if (body.search) {
      const s = esc(body.search);
      q = q.or(`course_code.ilike.%${s}%,course_title.ilike.%${s}%`);
    }
    return q as unknown as PromiseLike<{ data: SubjectRow[] | null; error: { message: string } | null }>;
  });
}

async function matchingCanvassing(db: ReturnType<typeof serviceClient>, body: Body): Promise<CanvassingRow[]> {
  return pageThrough<CanvassingRow>((from, to) => {
    let q = db.from("canvassing").select("id, title, supplier, canvass_date, unit_cost").range(from, to);
    if (body.fromDate) q = q.gte("canvass_date", body.fromDate);
    if (body.toDate) q = q.lte("canvass_date", body.toDate);
    if (body.supplier) q = q.ilike("supplier", `%${esc(body.supplier)}%`);
    return q as unknown as PromiseLike<{ data: CanvassingRow[] | null; error: { message: string } | null }>;
  });
}

async function deleteByIds(db: ReturnType<typeof serviceClient>, table: string, ids: number[]) {
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await db.from(table).delete().in("id", ids.slice(i, i + CHUNK));
    if (error) throw error;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Body;
    if (!body.table || !["titles", "subjects", "canvassing"].includes(body.table)) {
      return NextResponse.json({ error: "table must be one of: titles, subjects, canvassing" }, { status: 400 });
    }
    if (body.format && !isResourceTypeId(body.format)) {
      return NextResponse.json({ error: `Unknown format: ${body.format}` }, { status: 400 });
    }
    const db = serviceClient();
    const userEmail = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, userEmail);
    if (!perms.isAdmin && !perms.tabs["upload"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to bulk-delete." }, { status: 403 });
    }

    if (body.table === "titles") {
      const rows = await matchingTitles(db, body);
      if (body.dryRun) {
        return NextResponse.json({
          count: rows.length,
          sample: rows.slice(0, SAMPLE_SIZE).map((r) => ({
            title: r.title, author: r.author, format: r.format, campus: r.campus, year: r.year, copies: r.copies,
          })),
        });
      }
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { error } = await db.from("assignments").delete().in("title_id", ids.slice(i, i + CHUNK));
          if (error) throw error;
        }
        await deleteByIds(db, "titles", ids);
      }
      if (ids.length > 0) {
        await logActivity(db, {
          userEmail, action: "bulk_delete",
          summary: `Bulk-deleted ${ids.length} title${ids.length === 1 ? "" : "s"}${body.format ? ` (${body.format})` : ""}`,
          detail: { table: "titles", count: ids.length, filters: body },
        });
      }
      return NextResponse.json({ ok: true, count: ids.length });
    }

    if (body.table === "subjects") {
      const rows = await matchingSubjects(db, body);
      if (body.dryRun) {
        const { data: programRows } = await db.from("programs").select("id, name");
        const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));
        return NextResponse.json({
          count: rows.length,
          sample: rows.slice(0, SAMPLE_SIZE).map((r) => ({
            course_code: r.course_code, course_title: r.course_title, program: programMap.get(r.program_id) ?? "",
          })),
        });
      }
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { error } = await db.from("assignments").delete().in("subject_id", ids.slice(i, i + CHUNK));
          if (error) throw error;
        }
        await deleteByIds(db, "subjects", ids);
      }
      if (ids.length > 0) {
        await logActivity(db, {
          userEmail, action: "bulk_delete",
          summary: `Bulk-deleted ${ids.length} subject${ids.length === 1 ? "" : "s"}`,
          detail: { table: "subjects", count: ids.length, filters: body },
        });
      }
      return NextResponse.json({ ok: true, count: ids.length });
    }

    // canvassing
    const rows = await matchingCanvassing(db, body);
    if (body.dryRun) {
      return NextResponse.json({
        count: rows.length,
        sample: rows.slice(0, SAMPLE_SIZE).map((r) => ({
          title: r.title, supplier: r.supplier, canvass_date: r.canvass_date, unit_cost: r.unit_cost,
        })),
      });
    }
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await deleteByIds(db, "canvassing", ids);
      await logActivity(db, {
        userEmail, action: "bulk_delete",
        summary: `Bulk-deleted ${ids.length} canvassing record${ids.length === 1 ? "" : "s"}`,
        detail: { table: "canvassing", count: ids.length, filters: body },
      });
    }
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
