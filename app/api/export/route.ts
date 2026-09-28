import { loadProgramBibliography, loadCombinedProgramBibliography } from "@/lib/bibliography";
import {
  programBibliographyCsv,
  programBibliographyDocx,
  programBibliographyPdf,
  programBibliographyXlsx,
  programCitationsDocx,
  programCitationsTxt,
} from "@/lib/exports";
import type { CitationStyle } from "@/lib/types";
import { isResourceTypeId, type ResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeName(s: string) {
  return s.replace(/[^A-Za-z0-9_\-]+/g, "_").slice(0, 60) || "program";
}

const VALID_STYLES: CitationStyle[] = ["apa7", "mla9", "chicago", "harvard"];

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const programIdParam = (u.searchParams.get("program_id") ?? "").trim();
    // "all" means every program in the system, combined into one report --
    // the counterpart to ValidateAllProgramsAdmin's system-wide check,
    // which needs a CSV whose rows already span every program to validate
    // against (see programBibliographyCsv's Program column).
    const allPrograms = programIdParam.toLowerCase() === "all";
    const programId = allPrograms ? NaN : parseInt(programIdParam, 10);
    const fmt = (u.searchParams.get("fmt") ?? "xlsx").toLowerCase();
    const campus = (u.searchParams.get("campus") ?? "").trim();
    const styleParam = (u.searchParams.get("style") ?? "apa7").toLowerCase() as CitationStyle;
    const style = VALID_STYLES.includes(styleParam) ? styleParam : "apa7";

    if (!allPrograms && !Number.isFinite(programId)) {
      return new Response(JSON.stringify({ error: "program_id is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    const subjectIdParam = parseInt(u.searchParams.get("subject_id") ?? "", 10);
    const subjectId = !allPrograms && Number.isFinite(subjectIdParam) ? subjectIdParam : undefined;
    const subjectLabel = u.searchParams.get("subject_label") ?? "";
    const minYear = parseInt(u.searchParams.get("from_year") ?? "", 10);
    const maxYear = parseInt(u.searchParams.get("to_year") ?? "", 10);
    // Presence of the param (even empty) means "filter to exactly this set,
    // possibly none" -- distinct from omitting it entirely, which means no
    // filtering at all (every resource type included, the old default).
    const types: ResourceTypeId[] | undefined = u.searchParams.has("types")
      ? (u.searchParams.get("types") ?? "").split(",").filter(isResourceTypeId)
      : undefined;
    // Optional: fold one or more other programs' course lists into this
    // export as extra labeled sections (see loadCombinedProgramBibliography)
    // -- not offered together with a single-course export (subject_id),
    // which is already scoped to one course.
    const combineWith = !subjectId && !allPrograms
      ? (u.searchParams.get("combine_with") ?? "")
          .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n !== programId)
      : [];

    let data;
    if (allPrograms) {
      const { data: programRows, error } = await serviceClient().from("programs").select("id");
      if (error) throw error;
      const allIds = (programRows ?? []).map((p: { id: number }) => p.id);
      data = await loadCombinedProgramBibliography(
        allIds, campus,
        Number.isFinite(minYear) ? minYear : undefined,
        Number.isFinite(maxYear) ? maxYear : undefined,
        types,
      );
    } else if (combineWith.length) {
      data = await loadCombinedProgramBibliography(
        [programId, ...combineWith], campus,
        Number.isFinite(minYear) ? minYear : undefined,
        Number.isFinite(maxYear) ? maxYear : undefined,
        types,
      );
    } else {
      data = await loadProgramBibliography(
        programId, campus, subjectId,
        Number.isFinite(minYear) ? minYear : undefined,
        Number.isFinite(maxYear) ? maxYear : undefined,
        types,
      );
    }
    const baseName = safeName(
      allPrograms
        ? `all_programs${campus ? "_" + campus : ""}`
        : subjectId && subjectLabel
          ? subjectLabel
          : `${data.program.name}${campus ? "_" + campus : ""}`,
    );

    let body: Buffer; let media: string; let ext: string;
    switch (fmt) {
      case "csv":
        body = programBibliographyCsv(data);
        media = "text/csv"; ext = "csv"; break;
      case "pdf":
        body = await programBibliographyPdf(data);
        media = "application/pdf"; ext = "pdf"; break;
      case "docx":
        body = await programBibliographyDocx(data);
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        ext = "docx"; break;
      case "citations-docx":
        body = await programCitationsDocx(data, style);
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        ext = `citations-${style}.docx`; break;
      case "citations-txt":
        body = programCitationsTxt(data, style);
        media = "text/plain";
        ext = `citations-${style}.txt`; break;
      case "xlsx":
      default:
        body = await programBibliographyXlsx(data);
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        ext = "xlsx";
    }
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": media,
        "Content-Disposition": `attachment; filename="${baseName}.${ext}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
