/**
 * NDJSON streaming helper for long-running routes that want to report
 * progress (uploads, matching, ...).
 *
 * Usage in a Next.js Node-runtime route:
 *   const stream = ndjsonStream(async (send) => {
 *     send({ phase: "parsing" });
 *     ...
 *     send({ phase: "done", inserted, received });
 *   });
 *   return new Response(stream, {
 *     headers: { "Content-Type": "application/x-ndjson" },
 *   });
 *
 * Errors are caught and surfaced as a {phase:"error", error} event so the
 * client always sees a terminal event — every event union passed as T must
 * include that variant. Pass an explicit type argument (e.g.
 * ndjsonStream<MatchProgressEvent>(...)) for anything other than the default
 * upload-flavored ProgressEvent.
 */
import { errorMessage } from "./errors";

export type ProgressEvent =
  | { phase: "parsing" }
  | { phase: "parsed"; total: number }
  | { phase: "deduping"; existing: number }
  | { phase: "inserting"; inserted: number; skipped: number; total: number }
  | { phase: "done"; received: number; inserted: number; skipped: number; programs?: number; duplicates?: number }
  | { phase: "error"; error: string };

/** Client-side counterpart: reads an ndjsonStream response line by line. */
export async function consumeNdjson<T = ProgressEvent>(
  res: Response,
  onEvent: (ev: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal?.aborted) { reader.cancel(); break; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line) as T); } catch { /* skip */ }
    }
  }
}

export function ndjsonStream<T extends { phase: string } = ProgressEvent>(
  run: (send: (e: T) => void) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: T) => {
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        await run(send);
      } catch (err) {
        send({ phase: "error", error: errorMessage(err) } as unknown as T);
      } finally {
        controller.close();
      }
    },
  });
}
