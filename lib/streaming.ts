/**
 * NDJSON streaming helper for upload routes.
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
 * client always sees a terminal event.
 */
export type ProgressEvent =
  | { phase: "parsing" }
  | { phase: "parsed"; total: number }
  | { phase: "inserting"; inserted: number; total: number }
  | { phase: "done"; received: number; inserted: number; programs?: number }
  | { phase: "error"; error: string };

export function ndjsonStream(
  run: (send: (e: ProgressEvent) => void) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        await run(send);
      } catch (err) {
        send({ phase: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
}
