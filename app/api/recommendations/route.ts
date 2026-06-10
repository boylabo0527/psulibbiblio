import { NextResponse } from "next/server";
import { loadRecommendations } from "@/lib/recommendations";
import type { CitationStyle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const data = await loadRecommendations({
      campus: u.searchParams.get("campus") ?? undefined,
      college: u.searchParams.get("college") ?? undefined,
      program: u.searchParams.get("program") ?? undefined,
      course: u.searchParams.get("course") ?? undefined,
      author: u.searchParams.get("author") ?? undefined,
      publisher: u.searchParams.get("publisher") ?? undefined,
      year: u.searchParams.get("year") ?? undefined,
      style: (u.searchParams.get("style") as CitationStyle) ?? "apa7",
    });
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
