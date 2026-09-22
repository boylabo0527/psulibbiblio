import { NextResponse } from "next/server";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Online materials" = every resource type whose medium is digital (paid,
// open-access, and complementary eBooks and online journals, plus the
// institutional repository) -- everything that ISN'T a printed book or
// printed journal. See lib/resources.ts for the full type table.
const ONLINE_TYPE_IDS = RESOURCE_TYPES.filter((t) => t.medium === "digital").map((t) => t.id);

// Any site may embed this -- it's a single aggregate number with no
// per-title detail, the same one shown on this app's own public
// Dashboard tab. No Authorization header is required either (see the
// "/api/public" bypass in middleware.ts); these two headers are what
// actually let another origin's browser JS read the response, since a
// plain fetch() is blocked cross-origin without them regardless of the
// endpoint requiring auth or not.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export type OnlineMaterialsCountResponse =
  | {
      count: number;
      label: "Online Materials";
      breakdown: Partial<Record<ResourceTypeId, number>>;
      generatedAt: string;
    }
  | { error: string };

/** GET /api/public/online-materials-count -- read-only aggregate count of
 *  every digital-medium title (see ONLINE_TYPE_IDS above), for embedding
 *  on other sites/apps (a public-facing stat tile, a library homepage
 *  widget, etc). Cached at Vercel's edge for a couple of minutes (see the
 *  Cache-Control header below) so repeated polling from elsewhere doesn't
 *  hit Supabase on every request -- this number doesn't need to be
 *  second-by-second accurate. */
export async function GET() {
  try {
    const db = serviceClient();

    const { count: total, error } = await db
      .from("titles")
      .select("*", { count: "exact", head: true })
      .in("format", ONLINE_TYPE_IDS);
    if (error) throw error;

    const breakdown = {} as Partial<Record<ResourceTypeId, number>>;
    await Promise.all(ONLINE_TYPE_IDS.map(async (id) => {
      const { count } = await db.from("titles").select("*", { count: "exact", head: true }).eq("format", id);
      breakdown[id] = count ?? 0;
    }));

    return NextResponse.json(
      {
        count: total ?? 0,
        label: "Online Materials",
        breakdown,
        generatedAt: new Date().toISOString(),
      } satisfies OnlineMaterialsCountResponse,
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) } satisfies OnlineMaterialsCountResponse,
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/** Browsers preflight a cross-origin request when it's not a "simple"
 *  one (e.g. some HTTP clients add headers that trigger this even for a
 *  plain GET) -- handle it explicitly rather than relying on every
 *  caller's request happening to qualify as simple. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
