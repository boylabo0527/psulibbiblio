import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Routes that anyone (signed in or not) may call, matching the path and
 *  any of its sub-paths (e.g. "/api/dashboard" also covers
 *  "/api/dashboard/subjects"). The Dashboard tab on the public homepage is
 *  wired to the endpoints listed below. */
const PUBLIC_API_PREFIX = ["/api/health", "/api/dashboard", "/api/export", "/api/campuses", "/api/program-campuses"];

/** Public, but ONLY that exact path -- not sub-paths. "/api/programs" (the
 *  bare program list) is genuinely public for the Dashboard's filter
 *  dropdown, but "/api/programs/:id/bibliography" (full title-level detail
 *  for one program), "/api/programs/:id" (rename/delete), "/api/programs/
 *  duplicates", and "/api/programs/merge" are not -- a prefix match here
 *  previously left all of those open to anyone, signed in or not, with no
 *  campus-scope check at all. */
const PUBLIC_API_EXACT = ["/api/programs"];

/** Exact paths where an unauthenticated POST is allowed too, not just GET
 *  -- kept to a tiny, explicit allowlist (currently just the public title
 *  suggestion form) rather than folding into PUBLIC_API_EXACT, since every
 *  other public path is deliberately read-only for anonymous visitors. */
const PUBLIC_API_POST_EXACT = ["/api/title-recommendations/public"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_API_EXACT.includes(pathname)) return true;
  for (const p of PUBLIC_API_PREFIX) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  // Vercel Cron has no Supabase user to sign in as -- it authenticates via
  // CRON_SECRET instead (checked in the route itself), sent as a plain
  // Bearer token that would otherwise fail Supabase JWT verification below
  // and 401 before the route ever got a chance to check it.
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }
  // The public bypass only applies to GET — POST/PUT/PATCH/DELETE on these
  // paths still require a signed-in user, even though anyone can read them.
  // The one exception is the tiny explicit POST allowlist above.
  const isPublicGet = isPublic(pathname) && req.method === "GET";
  const isPublicPost = PUBLIC_API_POST_EXACT.includes(pathname) && req.method === "POST";
  const isPublicNoAuth = isPublicGet || isPublicPost;

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    // No token at all on a public route just means an anonymous visitor
    // (e.g. the public Dashboard, or the public title-suggestion form) --
    // let it through unauthenticated.
    if (isPublicNoAuth) return NextResponse.next();
    return NextResponse.json(
      { error: "Sign in required to use this endpoint." },
      { status: 401 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Server is missing Supabase credentials." },
      { status: 500 },
    );
  }
  const client = createClient(url, key);
  const { data, error } = await client.auth.getUser(m[1]);
  if (error || !data.user) {
    // A stale/expired token on a public route shouldn't 401 a page that's
    // supposed to work signed-out too -- just fall back to anonymous.
    if (isPublicNoAuth) return NextResponse.next();
    return NextResponse.json(
      { error: error?.message ?? "Invalid or expired session." },
      { status: 401 },
    );
  }
  // Forwarded so route handlers can attribute activity-log entries to the
  // signed-in user (and, on the public-but-personalized routes above,
  // apply that user's campus scope) without re-verifying the token
  // themselves. Previously this whole verify-and-forward step was skipped
  // entirely for public GET routes, which meant a signed-in, campus-
  // restricted user's requests to e.g. /api/campuses or /api/programs
  // never carried x-user-email at all -- silently defeating campus
  // scoping there and showing every campus/program regardless of access.
  const headers = new Headers(req.headers);
  headers.set("x-user-email", data.user.email ?? "");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
