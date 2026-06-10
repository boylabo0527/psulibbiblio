import { parseSubjects } from "@/lib/parsers";
import { ndjsonStream } from "@/lib/streaming";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TICK_EVERY = 25;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const programOverride = (form.get("program") as string | null)?.trim() || "";
  const campusOverride = (form.get("campus") as string | null)?.trim() || "";
  const collegeOverride = (form.get("college") as string | null)?.trim() || "";

  const stream = ndjsonStream(async (send) => {
    if (!(file instanceof File)) throw new Error("Missing file");
    send({ phase: "parsing" });
    const buf = Buffer.from(await file.arrayBuffer());
    const records = await parseSubjects(file.name, buf);
    send({ phase: "parsed", total: records.length });
    if (!records.length) {
      send({ phase: "done", received: 0, inserted: 0, programs: 0 });
      return;
    }
    const db = serviceClient();

    const programCache = new Map<string, number>();
    let inserted = 0;
    let programsCreated = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const progName = (programOverride || rec.program || "").trim();
      const campus = (campusOverride || rec.campus || "").trim();
      const college = (collegeOverride || rec.college || "").trim();
      if (!progName) {
        throw new Error("No 'program' column found and no program override provided.");
      }
      const key = `${progName}|${campus}|${college}`;
      let pid = programCache.get(key);
      if (!pid) {
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
      if (inserted % TICK_EVERY === 0 || inserted === records.length) {
        send({ phase: "inserting", inserted, total: records.length });
      }
    }
    send({ phase: "done", received: records.length, inserted, programs: programsCreated });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
