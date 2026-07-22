import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { parseYear } from "@/lib/years";
import { isResourceTypeId } from "@/lib/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  table?: "titles" | "subjects" | "canvassing";
  dryRun?: boolean;
  format?: string;
  campus?: string;
  fromYear?: number;
  toYear?: number;
  programId?: number;
  fromDate?: string;
  toDate?: string;
};

async function matchingTitleIds(db: ReturnType<typeof serviceClient>, body: Body): Promise<number[]> {
  type Row = { id: number; year: string };
  const rows = await pageThrough<Row>((from, to) => {
    let q = db.from("titles").select("id, year").range(from, to);
    if (body.format) q = q.eq("format", body.format);
    if (body.campus) q = q.eq("campus", body.campus);
    return q as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });
  const hasYearFilter = body.fromYear != null || body.toYear != null;
  return rows
    .filter((r) => {
      if (!hasYearFilter) return true;
      // A year filter is a targeting tool for deletion, so — unlike the
      // report filter — a row with no readable year does NOT match; we'd
      // rather under-delete than guess and remove something unintended.
      const y = parseYear(r.year);
      if (y === null) return false;
      if (body.fromYear != null && y < body.fromYear) return false;
      if (body.toYear != null && y > body.toYear) return false;
      return true;
    })
    .map((r) => r.id);
}

async function matchingSubjectIds(db: ReturnType<typeof serviceClient>, body: Body): Promise<number[]> {
  type Row = { id: number };
  const rows = await pageThrough<Row>((from, to) => {
    let q = db.from("subjects").select("id").range(from, to);
    if (body.programId) q = q.eq("program_id", body.programId);
    return q as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });
  return rows.map((r) => r.id);
}

async function matchingCanvassingIds(db: ReturnType<typeof serviceClient>, body: Body): Promise<number[]> {
  type Row = { id: number };
  const rows = await pageThrough<Row>((from, to) => {
    let q = db.from("canvassing").select("id").range(from, to);
    if (body.fromDate) q = q.gte("canvass_date", body.fromDate);
    if (body.toDate) q = q.lte("canvass_date", body.toDate);
    return q as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });
  return rows.map((r) => r.id);
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

    let ids: number[];
    if (body.table === "titles") ids = await matchingTitleIds(db, body);
    else if (body.table === "subjects") ids = await matchingSubjectIds(db, body);
    else ids = await matchingCanvassingIds(db, body);

    if (body.dryRun) {
      return NextResponse.json({ count: ids.length });
    }

    // titles/subjects are referenced by assignments with no cascade — clear
    // those first so the delete doesn't fail on a foreign-key violation.
    if (ids.length > 0 && body.table === "titles") {
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await db.from("assignments").delete().in("title_id", ids.slice(i, i + CHUNK));
        if (error) throw error;
      }
    } else if (ids.length > 0 && body.table === "subjects") {
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await db.from("assignments").delete().in("subject_id", ids.slice(i, i + CHUNK));
        if (error) throw error;
      }
    }

    if (ids.length > 0) await deleteByIds(db, body.table, ids);

    return NextResponse.json({ ok: true, count: ids.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
