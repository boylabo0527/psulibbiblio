import { parseSubjects } from "@/lib/parsers";
import { pageThrough } from "@/lib/paging";
import { ndjsonStream } from "@/lib/streaming";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
      send({ phase: "done", received: 0, inserted: 0, skipped: 0, programs: 0 });
      return;
    }
    const db = serviceClient();

    // Pre-fetch existing subjects keyed by (program_id, course_code, course_title)
    // so re-uploading the same file is a no-op.
    const existing = await pageThrough<{ program_id: number; course_code: string; course_title: string }>(
      (from, to) => db.from("subjects")
        .select("program_id, course_code, course_title")
        .range(from, to) as unknown as PromiseLike<{ data: { program_id: number; course_code: string; course_title: string }[] | null; error: { message: string } | null }>,
    );
    send({ phase: "deduping", existing: existing.length });
    const seen = new Set(existing.map((e) => `${e.program_id}|${e.course_code}|${e.course_title}`));

    const programCache = new Map<string, number>();
    let inserted = 0;
    let skipped = 0;
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

      const dedupKey = `${pid}|${rec.course_code ?? ""}|${rec.course_title}`;
      if (seen.has(dedupKey)) {
        skipped++;
      } else {
        const { error } = await db.from("subjects").insert({
          program_id: pid,
          section: rec.section ?? "",
          course_code: rec.course_code ?? "",
          course_title: rec.course_title,
          description: rec.description ?? "",
          sort_order: rec.sort_order ?? 0,
        });
        if (error) throw error;
        seen.add(dedupKey);
        inserted++;
      }
      if ((inserted + skipped) % TICK_EVERY === 0 || inserted + skipped === records.length) {
        send({ phase: "inserting", inserted, skipped, total: records.length });
      }
    }
    send({ phase: "done", received: records.length, inserted, skipped, programs: programsCreated });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
