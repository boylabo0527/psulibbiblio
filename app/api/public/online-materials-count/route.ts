import { NextResponse } from "next/server";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";
import { pageThroughParallel } from "@/lib/paging";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Online materials" = every resource type whose medium is digital (paid,
// open-access, and complementary eBooks and online journals, plus the
// institutional repository) -- everything that ISN'T a printed book or
// printed journal. See lib/resources.ts for the full type table. Order
// here (declaration order in RESOURCE_TYPES) is also the order the
// breakdown below reports in, so it reads the same as this app's own
// upload cards/tabs.
const ONLINE_TYPES = RESOURCE_TYPES.filter((t) => t.medium === "digital");
const ONLINE_TYPE_IDS = ONLINE_TYPES.map((t) => t.id);

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

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
};

export type OnlineMaterialsCountResponse =
  | {
      count: number;
      label: "Online Materials";
      // One entry per digital material type, in the order listed above --
      // "label" is the same human-readable name this app shows in its own
      // UI, so a report can display it directly without maintaining its
      // own copy of what each id (e.g. "ebook_paid") means.
      breakdown: { id: ResourceTypeId; label: string; count: number }[];
      generatedAt: string;
    }
  | { error: string };

export type OnlineMaterialsQuarterlyResponse =
  | {
      label: "Online Materials";
      generatedAt: string;
      // Titles catalogued before quarterly tracking existed (see
      // supabase/migrations/49_titles_created_at.sql) all share one
      // retroactive timestamp -- not a real acquisition date, so they're
      // reported separately rather than appearing as one implausible
      // quarter with a huge spike.
      baseline: { count: number; asOf: string | null; note: string };
      // Only quarters with at least one real title are included, in
      // chronological order. cumulativeTotal = baseline.count + every
      // added count up through that quarter, i.e. ready to plot directly
      // as a running-total growth line.
      quarters: { quarter: string; added: number; cumulativeTotal: number }[];
    }
  | { error: string };

function quarterLabel(iso: string): string {
  const d = new Date(iso);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

async function fetchOnlineTitleTimestamps(db: ReturnType<typeof serviceClient>) {
  return pageThroughParallel<{ created_at: string | null; created_at_backfilled: boolean }>(
    (from, to) =>
      db
        .from("titles")
        .select("created_at, created_at_backfilled", { count: "exact" })
        .in("format", ONLINE_TYPE_IDS)
        .order("created_at", { ascending: true })
        .range(from, to),
  );
}

/** GET /api/public/online-materials-count[?by=quarter] -- read-only
 *  count of every digital-medium title (see ONLINE_TYPE_IDS above), for
 *  embedding on other sites/apps (a public-facing stat tile, a library
 *  homepage widget, etc). Cached at Vercel's edge for a couple of
 *  minutes (see CACHE_HEADERS) so repeated polling from elsewhere
 *  doesn't hit Supabase on every request -- this number doesn't need to
 *  be second-by-second accurate.
 *
 *  Plain GET returns a flat total + per-type breakdown. ?by=quarter
 *  instead returns growth over time -- see OnlineMaterialsQuarterlyResponse
 *  and the migration referenced above for why a "baseline" bucket exists
 *  separately from real quarters. */
export async function GET(req: Request) {
  const by = new URL(req.url).searchParams.get("by");
  const db = serviceClient();

  if (by === "quarter") {
    try {
      const rows = await fetchOnlineTitleTimestamps(db);

      const backfilled = rows.filter((r) => r.created_at_backfilled);
      const organic = rows.filter((r) => !r.created_at_backfilled && r.created_at);

      const addedByQuarter = new Map<string, number>();
      for (const r of organic) {
        const q = quarterLabel(r.created_at!);
        addedByQuarter.set(q, (addedByQuarter.get(q) ?? 0) + 1);
      }
      const orderedQuarters = Array.from(addedByQuarter.keys()).sort();

      let running = backfilled.length;
      const quarters = orderedQuarters.map((quarter) => {
        const added = addedByQuarter.get(quarter)!;
        running += added;
        return { quarter, added, cumulativeTotal: running };
      });

      return NextResponse.json(
        {
          label: "Online Materials",
          generatedAt: new Date().toISOString(),
          baseline: {
            count: backfilled.length,
            asOf: backfilled[0]?.created_at ?? null,
            note: "Titles already catalogued before quarterly tracking started -- not a real acquisition quarter.",
          },
          quarters,
        } satisfies OnlineMaterialsQuarterlyResponse,
        { headers: { ...CORS_HEADERS, ...CACHE_HEADERS } },
      );
    } catch (err) {
      return NextResponse.json(
        { error: errorMessage(err) } satisfies OnlineMaterialsQuarterlyResponse,
        { status: 500, headers: CORS_HEADERS },
      );
    }
  }

  try {
    const { count: total, error } = await db
      .from("titles")
      .select("*", { count: "exact", head: true })
      .in("format", ONLINE_TYPE_IDS);
    if (error) throw error;

    const counts = {} as Record<ResourceTypeId, number>;
    await Promise.all(ONLINE_TYPE_IDS.map(async (id) => {
      const { count } = await db.from("titles").select("*", { count: "exact", head: true }).eq("format", id);
      counts[id] = count ?? 0;
    }));
    const breakdown = ONLINE_TYPES.map((t) => ({ id: t.id, label: t.uiLabel, count: counts[t.id] }));

    return NextResponse.json(
      {
        count: total ?? 0,
        label: "Online Materials",
        breakdown,
        generatedAt: new Date().toISOString(),
      } satisfies OnlineMaterialsCountResponse,
      { headers: { ...CORS_HEADERS, ...CACHE_HEADERS } },
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
