import { NextResponse } from "next/server";
import { loadProgramBibliography } from "@/lib/bibliography";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad program id" }, { status: 400 });
    }
    const u = new URL(req.url);
    const campus = (u.searchParams.get("campus") ?? "").trim();
    const minYear = parseInt(u.searchParams.get("from_year") ?? "", 10);
    const maxYear = parseInt(u.searchParams.get("to_year") ?? "", 10);
    const data = await loadProgramBibliography(
      id, campus, undefined,
      Number.isFinite(minYear) ? minYear : undefined,
      Number.isFinite(maxYear) ? maxYear : undefined,
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) },
      { status: 500 },
    );
  }
}
