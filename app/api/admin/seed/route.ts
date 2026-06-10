import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serviceClient } from "@/lib/supabase";
import { parseCourses } from "@/lib/parsers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const csvPath = path.join(process.cwd(), "data", "psu_programs.csv");
    const buf = await readFile(csvPath);
    const records = await parseCourses("psu_programs.csv", buf);
    const seedRows = records.map((r) => ({
      campus: r.campus ?? "",
      college: r.college ?? "",
      program: r.program ?? "",
      major: r.major ?? "",
      course_code: "",
      course_title: r.major ? `${r.program} - ${r.major}` : r.program ?? "Untitled",
      description: `${r.program ?? ""} program at ${r.college ?? ""}, ${r.campus ?? ""}.${r.major ? ` Major/track: ${r.major}.` : ""}`,
      learning_outcomes: "",
      keywords: r.major ?? "",
      enrollment: 0,
    }));
    const db = serviceClient();
    let inserted = 0;
    for (let i = 0; i < seedRows.length; i += 500) {
      const slice = seedRows.slice(i, i + 500);
      const { data, error } = await db.from("courses").insert(slice).select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
    }
    return NextResponse.json({ inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
