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

/**
 * Like pageThrough, but fetches pages CONCURRENTLY instead of one at a time.
 * For a large table (tens of thousands of rows+), sequential pages mean the
 * total time is pages x round-trip-latency; fetching several pages at once
 * cuts that by roughly the concurrency factor. Requires the query to ask
 * Supabase for an exact count (`{ count: "exact" }`) so the total page count
 * is known after the first request.
 */
export async function pageThroughParallel<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }>,
  onProgress?: (done: number, total: number) => void,
  concurrency = 6,
): Promise<T[]> {
  const first = await query(0, PAGE - 1);
  if (first.error) throw new Error(first.error.message);
  const out: T[] = [...(first.data ?? [])];
  const total = first.count ?? out.length;
  onProgress?.(out.length, total);
  if (out.length >= total || (first.data?.length ?? 0) < PAGE) return out;

  const ranges: [number, number][] = [];
  for (let from = PAGE; from < total; from += PAGE) ranges.push([from, from + PAGE - 1]);

  let done = out.length;
  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = ranges.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(([from, to]) => query(from, to)));
    for (const r of results) {
      if (r.error) throw new Error(r.error.message);
      out.push(...(r.data ?? []));
      done += r.data?.length ?? 0;
    }
    onProgress?.(done, total);
  }
  return out;
}
