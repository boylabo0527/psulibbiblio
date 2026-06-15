import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Routes that anyone (signed in or not) may call. Everything else under
 *  /api/* requires a valid Supabase access token in the Authorization
 *  header. The Dashboard tab on the public homepage is wired to the
 *  endpoints listed below. */
const PUBLIC_API = ["/api/health", "/api/dashboard", "/api/export", "/api/programs"];

function isPublic(pathname: string): boolean {
  for (const p of PUBLIC_API) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/") || isPublic(pathname)) {
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
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
    return NextResponse.json(
      { error: error?.message ?? "Invalid or expired session." },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
