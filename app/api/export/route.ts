import { loadRecommendations } from "@/lib/recommendations";
import { toCsv, toDocx, toPdf, toXlsx } from "@/lib/exports";
import type { CitationStyle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const fmt = (u.searchParams.get("fmt") ?? "xlsx").toLowerCase();
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

    let body: Buffer;
    let media: string;
    let name: string;
    switch (fmt) {
      case "csv":  body = toCsv(data.rows);  media = "text/csv"; name = "recommendations.csv"; break;
      case "pdf":  body = await toPdf(data.rows);  media = "application/pdf"; name = "recommendations.pdf"; break;
      case "docx": body = await toDocx(data.rows); media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; name = "recommendations.docx"; break;
      case "xlsx":
      default:    body = await toXlsx(data.rows); media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; name = "recommendations.xlsx";
    }
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": media,
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
