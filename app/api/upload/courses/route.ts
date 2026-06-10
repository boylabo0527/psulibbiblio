import { NextResponse } from "next/server";
import { parseCourses } from "@/lib/parsers";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 500;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const records = await parseCourses(file.name, buf);
    if (records.length === 0) return NextResponse.json({ received: 0, inserted: 0 });

    const db = serviceClient();
    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const slice = records.slice(i, i + BATCH).map((c) => ({
        campus: c.campus ?? "",
        college: c.college ?? "",
        program: c.program ?? "",
        major: c.major ?? "",
        course_code: c.course_code ?? "",
        course_title: c.course_title,
        description: c.description ?? "",
        learning_outcomes: c.learning_outcomes ?? "",
        keywords: c.keywords ?? "",
        enrollment: c.enrollment ?? 0,
      }));
      const { data, error } = await db.from("courses").insert(slice).select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
    }
    return NextResponse.json({ received: records.length, inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
