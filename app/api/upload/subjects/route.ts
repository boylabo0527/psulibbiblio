import { parseSubjects } from "@/lib/parsers";
import { pageThrough } from "@/lib/paging";
import { ndjsonStream } from "@/lib/streaming";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 500;

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

    // Pre-fetch existing subjects so re-uploading the same file is a no-op.
    const existing = await pageThrough<{ program_id: number; course_code: string; course_title: string }>(
      (from, to) => db.from("subjects")
        .select("program_id, course_code, course_title")
        .range(from, to) as unknown as PromiseLike<{ data: { program_id: number; course_code: string; course_title: string }[] | null; error: { message: string } | null }>,
    );
    send({ phase: "deduping", existing: existing.length });
    const seen = new Set(existing.map((e) => `${e.program_id}|${e.course_code}|${e.course_title}`));

    // Resolve all program ids first (one round-trip per distinct program).
    const programCache = new Map<string, number>();
    let programsCreated = 0;

    const resolveProgram = async (progName: string, campus: string, college: string): Promise<number> => {
      const key = `${progName}|${campus}|${college}`;
      const cached = programCache.get(key);
      if (cached) return cached;
      const existing = await db.from("programs")
        .select("id")
        .eq("campus", campus).eq("college", college).eq("name", progName)
        .maybeSingle();
      let pid: number;
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
      return pid;
    };

    // First pass: resolve every row's program_id and dedup. No DB writes for
    // subjects yet — we'll batch insert them next.
    type Ready = {
      program_id: number; section: string; course_code: string;
      course_title: string; description: string; sort_order: number;
    };
    const ready: Ready[] = [];
    let skipped = 0;
    for (const rec of records) {
      const progName = (programOverride || rec.program || "").trim();
      const campus = (campusOverride || rec.campus || "").trim();
      const college = (collegeOverride || rec.college || "").trim();
      if (!progName) {
        throw new Error("No 'program' column found and no program override provided.");
      }
      const pid = await resolveProgram(progName, campus, college);
      const dedupKey = `${pid}|${rec.course_code ?? ""}|${rec.course_title}`;
      if (seen.has(dedupKey)) { skipped++; continue; }
      seen.add(dedupKey);
      ready.push({
        program_id: pid,
        section: rec.section ?? "",
        course_code: rec.course_code ?? "",
        course_title: rec.course_title,
        description: rec.description ?? "",
        sort_order: rec.sort_order ?? 0,
      });
    }
    send({ phase: "inserting", inserted: 0, skipped, total: records.length });

    // Batched bulk insert.
    let inserted = 0;
    for (let i = 0; i < ready.length; i += BATCH) {
      const slice = ready.slice(i, i + BATCH);
      const { data, error } = await db.from("subjects").insert(slice).select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
      send({ phase: "inserting", inserted, skipped, total: records.length });
    }
    send({ phase: "done", received: records.length, inserted, skipped, programs: programsCreated });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
