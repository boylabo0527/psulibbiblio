import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Routes that anyone (signed in or not) may call, matching the path and
 *  any of its sub-paths (e.g. "/api/dashboard" also covers
 *  "/api/dashboard/subjects"). The Dashboard tab on the public homepage is
 *  wired to the endpoints listed below. */
const PUBLIC_API_PREFIX = ["/api/health", "/api/dashboard", "/api/export", "/api/campuses", "/api/program-campuses", "/api/settings"];

/** Public, but ONLY that exact path -- not sub-paths. "/api/programs" (the
 *  bare program list) is genuinely public for the Dashboard's filter
 *  dropdown, but "/api/programs/:id/bibliography" (full title-level detail
 *  for one program), "/api/programs/:id" (rename/delete), "/api/programs/
 *  duplicates", and "/api/programs/merge" are not -- a prefix match here
 *  previously left all of those open to anyone, signed in or not, with no
 *  campus-scope check at all. */
const PUBLIC_API_EXACT = ["/api/programs"];

/** "/api/programs/:id/journals" specifically (any program id) -- unlike
 *  ":id/bibliography" above, this route returns only a program's journal
 *  subscriptions (see its own comment), not per-course book detail, so it's
 *  safe to expose the same way the rest of the public Dashboard/Procurement
 *  Analysis is. A regex, not a prefix, so it can't accidentally also match
 *  ":id/bibliography" or any other sub-path under "/api/programs/:id/". */
const PUBLIC_PROGRAM_JOURNALS_RE = /^\/api\/programs\/[^/]+\/journals$/;

/** Exact paths where an unauthenticated POST is allowed too, not just GET
 *  -- kept to a tiny, explicit allowlist (currently just the public title
 *  suggestion form) rather than folding into PUBLIC_API_EXACT, since every
 *  other public path is deliberately read-only for anonymous visitors. */
const PUBLIC_API_POST_EXACT = ["/api/title-recommendations/public"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_API_EXACT.includes(pathname)) return true;
  if (PUBLIC_PROGRAM_JOURNALS_RE.test(pathname)) return true;
  for (const p of PUBLIC_API_PREFIX) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

/** Supabase project host, derived from the env var so the CSP's connect-src
 *  doesn't need a wildcard -- e.g. "https://YOUR-PROJECT.supabase.co". Falls
 *  back to the wildcard only if the env var is missing so a misconfigured
 *  deploy doesn't also break auth/data fetches with a CSP violation on top. */
function supabaseConnectSrc(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "https://*.supabase.co";
  try {
    return new URL(url).origin;
  } catch {
    return "https://*.supabase.co";
  }
}

/** Built once per request (not per module load) so every response gets its
 *  own nonce -- reusing one across requests would let an attacker who ever
 *  saw it replay it into an injected <script nonce="..."> tag. Next.js
 *  reads the nonce back out of this header to sign the inline bootstrap
 *  scripts it injects for hydration, so script-src can stay nonce-only
 *  instead of falling back to 'unsafe-inline'.
 *  https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Inline style ATTRIBUTES (style={{...}}, used throughout the tab
    // components) aren't covered by a nonce -- CSP nonces only apply to
    // elements, not attributes -- so style-src needs 'unsafe-inline' here.
    // That's a much smaller risk than script-src 'unsafe-inline' would be.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseConnectSrc()}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function withSecurityHeaders(res: NextResponse, nonce: string): NextResponse {
  res.headers.set("Content-Security-Policy", buildCsp(nonce));
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Forwarded to the app so Next.js can pick it up for the inline scripts
  // it injects (see buildCsp above); the response header is what actually
  // enforces the policy in the browser.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  if (!pathname.startsWith("/api/")) {
    return withSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
    );
  }
  // Vercel Cron has no Supabase user to sign in as -- it authenticates via
  // CRON_SECRET instead (checked in the route itself), sent as a plain
  // Bearer token that would otherwise fail Supabase JWT verification below
  // and 401 before the route ever got a chance to check it.
  if (pathname.startsWith("/api/cron/")) {
    return withSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
    );
  }
  // The Destiny push script (see scripts/destiny-push.mjs) has no
  // Supabase session either -- it authenticates via DESTINY_INGEST_SECRET
  // instead (checked in the route itself), same reasoning as the cron
  // bypass just above.
  if (pathname === "/api/sync/destiny/ingest" || pathname.startsWith("/api/sync/destiny/ingest/")) {
    return withSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
    );
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
    if (isPublicNoAuth) {
      return withSecurityHeaders(
        NextResponse.next({ request: { headers: requestHeaders } }),
        nonce,
      );
    }
    return withSecurityHeaders(
      NextResponse.json(
        { error: "Sign in required to use this endpoint." },
        { status: 401 },
      ),
      nonce,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return withSecurityHeaders(
      NextResponse.json(
        { error: "Server is missing Supabase credentials." },
        { status: 500 },
      ),
      nonce,
    );
  }
  const client = createClient(url, key);
  const { data, error } = await client.auth.getUser(m[1]);
  if (error || !data.user) {
    // A stale/expired token on a public route shouldn't 401 a page that's
    // supposed to work signed-out too -- just fall back to anonymous.
    if (isPublicNoAuth) {
      return withSecurityHeaders(
        NextResponse.next({ request: { headers: requestHeaders } }),
        nonce,
      );
    }
    return withSecurityHeaders(
      NextResponse.json(
        { error: error?.message ?? "Invalid or expired session." },
        { status: 401 },
      ),
      nonce,
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
  requestHeaders.set("x-user-email", data.user.email ?? "");
  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
  );
}

export const config = {
  // Runs on every route (pages and API alike) so the security headers below
  // apply everywhere, not just /api/* as before -- excludes static assets
  // and the favicon, which don't need a per-request nonce/CSP.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
