import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  supplier: string;
  unit: string;
  stock_prop_no: string;
  unit_cost: number;
  quantity: number;
  notes: string;
  created_at: string;
};

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const programId = u.searchParams.get("program_id");
    const subjectId = u.searchParams.get("subject_id");
    const db = serviceClient();

    let q = db.from("canvassing")
      .select("*, subjects(course_code, course_title, program_id), programs(name)")
      .order("created_at", { ascending: false });
    if (subjectId) q = q.eq("subject_id", Number(subjectId));
    else if (programId) q = q.eq("program_id", Number(programId));

    const { data, error } = await q;
    if (error) throw error;

    const rows: CanvassingRow[] = (data ?? []).map((r: Record<string, unknown>) => {
      const sub = r.subjects as { course_code?: string; course_title?: string } | null;
      const prog = r.programs as { name?: string } | null;
      return {
        id: r.id as number,
        title: (r.title as string) ?? "",
        author: (r.author as string) ?? "",
        publisher: (r.publisher as string) ?? "",
        year: (r.year as string) ?? "",
        isbn: (r.isbn as string) ?? "",
        subject_id: (r.subject_id as number | null),
        subject_label: sub ? [sub.course_code, sub.course_title].filter(Boolean).join(" — ") : "",
        program_id: (r.program_id as number | null),
        program: prog?.name ?? "",
        supplier: (r.supplier as string) ?? "",
        unit: (r.unit as string) ?? "copy",
        stock_prop_no: (r.stock_prop_no as string) ?? "",
        unit_cost: Number(r.unit_cost ?? 0),
        quantity: Number(r.quantity ?? 1),
        notes: (r.notes as string) ?? "",
        created_at: (r.created_at as string) ?? "",
      };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const db = serviceClient();
    const { data, error } = await db.from("canvassing").insert({
      title: body.title,
      author: body.author ?? null,
      publisher: body.publisher ?? null,
      year: body.year ?? null,
      isbn: body.isbn ?? null,
      subject_id: body.subject_id ?? null,
      program_id: body.program_id ?? null,
      supplier: body.supplier ?? null,
      unit: body.unit ?? "copy",
      stock_prop_no: body.stock_prop_no ?? null,
      unit_cost: Number(body.unit_cost ?? 0),
      quantity: Number(body.quantity ?? 1),
      notes: body.notes ?? null,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ row: data });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const db = serviceClient();
    const { data, error } = await db.from("canvassing").update({
      title: body.title,
      author: body.author ?? null,
      publisher: body.publisher ?? null,
      year: body.year ?? null,
      isbn: body.isbn ?? null,
      subject_id: body.subject_id ?? null,
      program_id: body.program_id ?? null,
      supplier: body.supplier ?? null,
      unit: body.unit ?? "copy",
      stock_prop_no: body.stock_prop_no ?? null,
      unit_cost: Number(body.unit_cost ?? 0),
      quantity: Number(body.quantity ?? 1),
      notes: body.notes ?? null,
    }).eq("id", Number(body.id)).select().single();
    if (error) throw error;
    return NextResponse.json({ row: data });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const u = new URL(req.url);
    const id = Number(u.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const db = serviceClient();
    const { error } = await db.from("canvassing").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
