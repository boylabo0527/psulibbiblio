/**
 * Page through a Supabase select 1000 rows at a time. The caller passes a
 * function that takes (from, to) and returns the configured query.
 */
const PAGE = 1000;

export async function pageThrough<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  onChunk?: (count: number) => void,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    onChunk?.(out.length);
    if (data.length < PAGE) break;
  }
  return out;
}
