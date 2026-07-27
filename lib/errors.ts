/** Extracts a human-readable message from anything that might be thrown.
 *  Supabase/PostgREST errors (`{ message, details, hint, code }`, from
 *  `if (error) throw error`) are plain objects, not Error instances --
 *  `err instanceof Error` is false for them, so a naive
 *  `String(err)` produces the unhelpful "[object Object]" instead of the
 *  actual message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}
