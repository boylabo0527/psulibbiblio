import type { TitleRow } from "./types";
import type { ProgramBibliography } from "./exports";
import { RESOURCE_TYPES } from "./resources";

function splitAuthors(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*(?:;|,| and | & )\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function lastFirstInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((p) => p[0]?.toUpperCase() + ".")
    .join(" ");
  return `${last}, ${initials}`;
}

function formatAuthorsApa(raw: string): string {
  const list = splitAuthors(raw).map(lastFirstInitials);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}, & ${list[1]}`;
  if (list.length <= 20) {
    return list.slice(0, -1).join(", ") + ", & " + list[list.length - 1];
  }
  return list.slice(0, 19).join(", ") + ", ... " + list[list.length - 1];
}

function clean(s: string | undefined): string {
  return (s ?? "").toString().trim();
}

function endWithPeriod(s: string): string {
  if (!s) return s;
  return /[.!?]$/.test(s) ? s : s + ".";
}

export function apaCitation(t: TitleRow): string {
  const authors = formatAuthorsApa(clean(t.author));
  const year = clean(t.year) || "n.d.";
  const title = clean(t.title);
  const publisher = clean(t.publisher);
  const issn = clean(t.issn);
  const isbn = clean(t.isbn);
  const url = clean(t.url);

  const parts: string[] = [];
  if (authors) parts.push(endWithPeriod(authors));
  parts.push(`(${year}).`);
  if (title) parts.push(endWithPeriod(title));
  if (publisher) parts.push(endWithPeriod(publisher));
  if (issn) parts.push(`ISSN: ${issn}.`);
  else if (isbn) parts.push(`ISBN: ${isbn}.`);
  if (url) parts.push(url);
  return parts.join(" ").trim();
}

export type CitationGroup = {
  section: string;
  subjectHeading: string;
  description?: string;
  resourceLabel: string;
  citations: string[];
};

export function buildApaGroups(b: ProgramBibliography): CitationGroup[] {
  const groups: CitationGroup[] = [];
  for (const sec of b.bySection) {
    for (const sub of sec.subjects) {
      const heading = [sub.subject.course_code, sub.subject.course_title]
        .filter(Boolean)
        .join(" ");
      for (const t of RESOURCE_TYPES) {
        const list = sub.buckets[t.id];
        if (!list || list.length === 0) continue;
        const cites = list
          .map(apaCitation)
          .sort((a, b) => a.localeCompare(b));
        groups.push({
          section: sec.section,
          subjectHeading: heading,
          description: sub.subject.description,
          resourceLabel: t.sectionLabel,
          citations: cites,
        });
      }
    }
  }
  return groups;
}

export async function programCitationsDocx(b: ProgramBibliography): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } =
    await import("docx");
  const children: import("docx").FileChild[] = [];
  children.push(new Paragraph({ text: "PALAWAN STATE UNIVERSITY", heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({ text: b.campus || "All Campuses" }));
  children.push(new Paragraph({ text: "Library Services" }));
  children.push(new Paragraph({ text: b.program.name, heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: "References (APA 7)", heading: HeadingLevel.HEADING_2 }));
  children.push(new Paragraph({ text: "" }));

  let lastSection = "";
  let lastSubject = "";
  for (const g of buildApaGroups(b)) {
    if (g.section && g.section !== lastSection) {
      children.push(new Paragraph({ text: g.section, heading: HeadingLevel.HEADING_2 }));
      lastSection = g.section;
    }
    if (g.subjectHeading !== lastSubject) {
      children.push(new Paragraph({ text: g.subjectHeading, heading: HeadingLevel.HEADING_3 }));
      if (g.description) children.push(new Paragraph({ text: g.description }));
      lastSubject = g.subjectHeading;
    }
    children.push(new Paragraph({
      children: [new TextRun({ text: g.resourceLabel, italics: true })],
    }));
    for (const c of g.citations) {
      children.push(new Paragraph({
        text: c,
        alignment: AlignmentType.LEFT,
        indent: { left: 720, hanging: 720 },
      }));
    }
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}
