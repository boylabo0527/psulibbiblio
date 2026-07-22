import { NextResponse } from "next/server";
import { runMatch, subjectText, titleText } from "@/lib/matcher";
import { serviceClient } from "@/lib/supabase";
import { embedTexts, embeddingsEnabled, cosineSim } from "@/lib/embeddings";
import type { SubjectRow, TitleRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 1000;
const EMBED_BATCH = 64;
const SEMANTIC_WEIGHT = parseFloat(process.env.MATCH_SEMANTIC_WEIGHT ?? "0.5");

async function fetchAll<T>(
  db: ReturnType<typeof serviceClient>, table: string, columns: string,
  filter?: { col: string; value: number },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = q.eq(filter.col, filter.value);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/** Compute (or reuse cached) embeddings for subjects and titles. Any failure
 *  here — model unavailable, out of time, whatever — is caught by the
 *  caller, which falls back to BM25-only matching rather than failing the
 *  whole run. */
async function computeEmbeddings(
  db: ReturnType<typeof serviceClient>,
  subjects: SubjectRow[],
  titles: (TitleRow & { id: number; embedding: number[] | null })[],
): Promise<{ subjectEmbeddings: Map<number, number[]>; titleEmbeddings: Map<number, number[]> }> {
  const subjectEmbeddings = new Map<number, number[]>();
  const subjVecs = await embedTexts(subjects.map((s) => subjectText(s)));
  subjects.forEach((s, i) => subjectEmbeddings.set(s.id!, subjVecs[i]));

  const titleEmbeddings = new Map<number, number[]>();
  const missing: { id: number; text: string }[] = [];
  for (const t of titles) {
    if (Array.isArray(t.embedding) && t.embedding.length > 0) {
      titleEmbeddings.set(t.id, t.embedding);
    } else {
      missing.push({ id: t.id, text: titleText(t) });
    }
  }

  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    const batch = missing.slice(i, i + EMBED_BATCH);
    const vecs = await embedTexts(batch.map((m) => m.text));
    const upsertRows = batch.map((m, k) => {
      titleEmbeddings.set(m.id, vecs[k]);
      return { id: m.id, embedding: vecs[k] };
    });
    const { error } = await db.from("titles").upsert(upsertRows, { onConflict: "id" });
    if (error) throw error;
  }

  return { subjectEmbeddings, titleEmbeddings };
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const topK = parseInt(url.searchParams.get("top_k") ?? "10", 10);
    const minScore = parseFloat(url.searchParams.get("min_score") ?? "0.05");
    const programId = url.searchParams.get("program_id");
    const db = serviceClient();

    const subjects = await fetchAll<SubjectRow>(
      db, "subjects",
      "id, program_id, course_code, course_title, description",
      programId ? { col: "program_id", value: Number(programId) } : undefined,
    );
    const titles = await fetchAll<TitleRow & { id: number; embedding: number[] | null }>(
      db, "titles",
      "id, format, title, author, publisher, year, subjects, embedding",
    );
    if (!subjects.length || !titles.length) {
      return NextResponse.json(
        { error: "Need at least one subject and one title before matching." },
        { status: 400 },
      );
    }

    let subjectEmbeddings: Map<number, number[]> | undefined;
    let titleEmbeddings: Map<number, number[]> | undefined;
    let semanticUsed = false;
    if (embeddingsEnabled()) {
      try {
        const computed = await computeEmbeddings(db, subjects, titles);
        subjectEmbeddings = computed.subjectEmbeddings;
        titleEmbeddings = computed.titleEmbeddings;
        semanticUsed = true;
      } catch (embedErr) {
        console.error("Embeddings unavailable this run, falling back to BM25-only:", embedErr);
      }
    }

    const results = runMatch(subjects, titles, {
      topK, minScore,
      semanticWeight: SEMANTIC_WEIGHT,
      subjectEmbeddings, titleEmbeddings,
      cosineSim: semanticUsed ? cosineSim : undefined,
    });

    // Drop prior auto assignments for these subjects; keep manual rows.
    const subjectIds = subjects.map((s) => s.id!);
    for (let i = 0; i < subjectIds.length; i += 200) {
      const slice = subjectIds.slice(i, i + 200);
      const { error } = await db.from("assignments")
        .delete().in("subject_id", slice).eq("manual", 0);
      if (error) throw error;
    }

    const rows = results.map((r) => ({
      subject_id: r.subject_id,
      title_id: r.title_id,
      score: r.score,
      rank: r.rank,
      explanation: r.explanation ?? "",
      manual: 0,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const slice = rows.slice(i, i + 1000);
      const { error } = await db.from("assignments")
        .upsert(slice, { onConflict: "subject_id,title_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    return NextResponse.json({
      matches: results.length,
      subjects: subjects.length,
      titles: titles.length,
      semantic_used: semanticUsed,
    });
  } catch (err) {
    console.error("match/run error:", err);
    let msg: string;
    if (err instanceof Error) {
      msg = err.message;
    } else {
      try { msg = JSON.stringify(err); } catch { msg = String(err); }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
