/**
 * One-shot seed for PSU campus/college/program rows.
 * Run with:  npm run seed
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseCourses } from "../lib/parsers";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const csvPath = path.join(process.cwd(), "data", "psu_programs.csv");
  const buf = await readFile(csvPath);
  const records = await parseCourses("psu_programs.csv", buf);

  const rows = records.map((r) => ({
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

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const { data, error } = await db.from("courses").insert(slice).select("id");
    if (error) { console.error(error); process.exit(2); }
    inserted += data?.length ?? 0;
  }
  console.log(`Inserted ${inserted} program rows.`);
}

main();
