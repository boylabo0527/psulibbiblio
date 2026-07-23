import { serviceClient } from "./supabase";

export type MergeableTitle = {
  id: number; format: string; call_no: string; title: string; author: string;
  campus: string; copies: number;
};

/** Combine two title rows into one: copies are summed onto whichever row was
 *  created first, assignments move over (dropping any that would collide),
 *  and the newer row is deleted. Both rows must share a format. */
export async function mergeTitles(
  db: ReturnType<typeof serviceClient>, a: MergeableTitle, b: MergeableTitle,
): Promise<MergeableTitle> {
  const keepId = Math.min(a.id, b.id);
  const dropId = Math.max(a.id, b.id);
  const keepRow = keepId === a.id ? a : b;
  const dropRow = keepId === a.id ? b : a;
  const newCopies = (keepRow.copies ?? 1) + (dropRow.copies ?? 1);

  const { data: dropAssignments, error: assignErr } = await db.from("assignments")
    .select("id, subject_id").eq("title_id", dropId);
  if (assignErr) throw assignErr;
  for (const asn of dropAssignments ?? []) {
    const { error: updErr } = await db.from("assignments").update({ title_id: keepId }).eq("id", asn.id);
    if (updErr) {
      // Already assigned to the same subject under the kept title — drop the redundant row.
      await db.from("assignments").delete().eq("id", asn.id);
    }
  }

  const { error: copiesErr } = await db.from("titles").update({ copies: newCopies }).eq("id", keepId);
  if (copiesErr) throw copiesErr;
  const { error: delErr } = await db.from("titles").delete().eq("id", dropId);
  if (delErr) throw delErr;

  const { data: finalRow, error: finalErr } = await db.from("titles").select().eq("id", keepId).single();
  if (finalErr) throw finalErr;
  return finalRow as MergeableTitle;
}
