import { loadProgramBibliography } from "@/lib/bibliography";
import {
  programBibliographyCsv,
  programBibliographyDocx,
  programBibliographyPdf,
  programBibliographyXlsx,
} from "@/lib/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeName(s: string) {
  return s.replace(/[^A-Za-z0-9_\-]+/g, "_").slice(0, 60) || "program";
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const programId = parseInt(u.searchParams.get("program_id") ?? "", 10);
    const fmt = (u.searchParams.get("fmt") ?? "xlsx").toLowerCase();
    if (!Number.isFinite(programId)) {
      return new Response(JSON.stringify({ error: "program_id is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    const data = await loadProgramBibliography(programId);
    const baseName = safeName(data.program.name);

    let body: Buffer; let media: string; let ext: string;
    switch (fmt) {
      case "csv":  body = programBibliographyCsv(data); media = "text/csv"; ext = "csv"; break;
      case "pdf":  body = await programBibliographyPdf(data);  media = "application/pdf"; ext = "pdf"; break;
      case "docx": body = await programBibliographyDocx(data); media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; ext = "docx"; break;
      case "xlsx":
      default:     body = await programBibliographyXlsx(data); media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; ext = "xlsx";
    }
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": media,
        "Content-Disposition": `attachment; filename="${baseName}.${ext}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
