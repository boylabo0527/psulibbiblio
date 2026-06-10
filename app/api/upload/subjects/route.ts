import { NextResponse } from "next/server";
import { parseSubjects } from "@/lib/parsers";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const programOverride = (form.get("program") as string | null)?.trim() || "";
    const campusOverride = (form.get("campus") as string | null)?.trim() || "";
    const collegeOverride = (form.get("college") as string | null)?.trim() || "";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const records = await parseSubjects(file.name, buf);
    if (!records.length) return NextResponse.json({ received: 0, inserted: 0, programs: 0 });

    const db = serviceClient();

    type Key = string;
    const programKey = (p: string, ca: string, co: string) => `${p}${ca}${co}`;
    const programCache = new Map<Key, number>();

    let inserted = 0;
    let programsCreated = 0;

    for (const rec of records) {
      const progName = (programOverride || rec.program || "").trim();
      const campus = (campusOverride || rec.campus || "").trim();
      const college = (collegeOverride || rec.college || "").trim();
      if (!progName) {
        return NextResponse.json(
          { error: "No 'program' column found and no program override provided." },
          { status: 400 },
        );
      }
      const key = programKey(progName, campus, college);
      let pid = programCache.get(key);
      if (!pid) {
        // upsert program by (campus, college, name)
        const existing = await db.from("programs")
          .select("id")
          .eq("campus", campus).eq("college", college).eq("name", progName)
          .maybeSingle();
        if (existing.data?.id) {
          pid = existing.data.id as number;
        } else {
          const created = await db.from("programs")
            .insert({ campus, college, name: progName })
            .select("id").single();
          if (created.error) throw created.error;
          pid = created.data.id as number;
          programsCreated++;
        }
        programCache.set(key, pid);
      }

      const { error } = await db.from("subjects").insert({
        program_id: pid,
        section: rec.section ?? "",
        course_code: rec.course_code ?? "",
        course_title: rec.course_title,
        description: rec.description ?? "",
        sort_order: rec.sort_order ?? 0,
      });
      if (error) throw error;
      inserted++;
    }
    return NextResponse.json({ received: records.length, inserted, programs: programsCreated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
