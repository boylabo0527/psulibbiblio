/**
 * Per-program bibliography export shaped to match the BA_PolSci template
 * and split into per-resource-type sections.
 *
 * - sum sheet: per-subject Titles/Volumes for every resource type + totals
 * - Detail sheet: per-subject blocks with a typed table per resource type
 * - DOCX / PDF mirror the same layout (PDF uses hand-drawn bordered tables)
 */
import { RESOURCE_TYPES, type ResourceTypeId } from "./resources";
import type { TitleRow, SubjectRow, ProgramRow } from "./types";

export type Buckets = Record<ResourceTypeId, TitleRow[]>;

export type SubjectDetail = {
  subject: SubjectRow;
  buckets: Buckets;
};

export type ProgramBibliography = {
  program: ProgramRow;
  /** Campus the report is generated for. Empty = "all campuses". */
  campus: string;
  bySection: { section: string; subjects: SubjectDetail[] }[];
};

function bucketTotals(books: TitleRow[]) {
  let titles = 0;
  let volumes = 0;
  for (const b of books) {
    titles += 1;
    volumes += Math.max(1, b.copies ?? 1);
  }
  return { titles, volumes };
}

function subjectTotals(buckets: Buckets) {
  let titles = 0, volumes = 0;
  for (const t of RESOURCE_TYPES) {
    const sub = bucketTotals(buckets[t.id]);
    titles += sub.titles;
    volumes += t.medium === "print" ? sub.volumes : sub.titles;
  }
  return { titles, volumes };
}

const NON_EMPTY_TYPES = (buckets: Buckets) =>
  RESOURCE_TYPES.filter((t) => buckets[t.id].length > 0);

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
export async function programBibliographyXlsx(b: ProgramBibliography): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PSU Bibliography Generator";
  writeSummarySheet(wb, b);
  writeDetailSheet(wb, b);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function writeSummarySheet(wb: import("exceljs").Workbook, b: ProgramBibliography) {
  const ws = wb.addWorksheet("sum");
  // First two cols are course code + title; then for each resource type:
  // - one column for titles
  // - if print medium, also one column for volumes
  const typeCols = RESOURCE_TYPES.flatMap((t) =>
    t.medium === "print" ? [`${t.sectionLabel} Titles`, `${t.sectionLabel} Volumes`] : [`${t.sectionLabel} Titles`],
  );
  ws.columns = [
    { width: 14 }, { width: 50 },
    ...typeCols.map(() => ({ width: 16 })),
    { width: 14 }, { width: 14 },
  ];

  let r = 1;
  ws.getCell(r++, 1).value = "PALAWAN STATE UNIVERSITY";
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = b.campus || "All Campuses";
  ws.getCell(r++, 1).value = "Library Services";
  r++;
  ws.getCell(r++, 1).value = b.program.name;
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = "Summary of Professional Resources";
  ws.getRow(r - 1).font = { italic: true };
  r++;

  const header = ["Course Code", "Course Title", ...typeCols, "Total Titles", "Total Volumes"];
  ws.getRow(r).values = header;
  ws.getRow(r).font = { bold: true };
  r++;

  // Running totals per column for the Program Totals row.
  const colTotals: number[] = Array(header.length - 2).fill(0);

  for (const sec of b.bySection) {
    if (sec.section) {
      ws.getCell(r, 2).value = sec.section;
      ws.getRow(r).font = { bold: true };
      r++;
    }
    for (const sub of sec.subjects) {
      const cells: (string | number)[] = [sub.subject.course_code || "", sub.subject.course_title || ""];
      let typeIdx = 0;
      for (const t of RESOURCE_TYPES) {
        const tot = bucketTotals(sub.buckets[t.id]);
        cells.push(tot.titles);
        colTotals[typeIdx] += tot.titles; typeIdx++;
        if (t.medium === "print") {
          cells.push(tot.volumes);
          colTotals[typeIdx] += tot.volumes; typeIdx++;
        }
      }
      const all = subjectTotals(sub.buckets);
      cells.push(all.titles, all.volumes);
      colTotals[typeIdx] += all.titles; typeIdx++;
      colTotals[typeIdx] += all.volumes;
      ws.getRow(r).values = cells;
      r++;
    }
  }

  r++;
  ws.getCell(r, 1).value = "Program Totals";
  ws.getRow(r).font = { bold: true };
  for (let i = 0; i < colTotals.length; i++) {
    ws.getCell(r, 3 + i).value = colTotals[i];
  }
}

function writeDetailSheet(wb: import("exceljs").Workbook, b: ProgramBibliography) {
  const ws = wb.addWorksheet("Detail");
  ws.columns = [
    { width: 20 }, { width: 30 }, { width: 60 }, { width: 8 }, { width: 8 },
  ];
  let r = 1;
  ws.getCell(r++, 1).value = "PALAWAN STATE UNIVERSITY";
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = b.campus || "All Campuses";
  ws.getCell(r++, 1).value = "Library Services";
  r++;
  ws.getCell(r++, 1).value = b.program.name;
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = "Professional Resources";
  ws.getRow(r - 1).font = { italic: true };
  r++;

  for (const sec of b.bySection) {
    if (sec.section) {
      ws.getCell(r, 1).value = sec.section;
      ws.getRow(r).font = { bold: true };
      r++;
    }
    for (const sub of sec.subjects) {
      ws.getCell(r, 1).value = sub.subject.course_code || "";
      ws.getCell(r, 2).value = sub.subject.course_title || "";
      ws.getRow(r).font = { bold: true };
      r++;
      if (sub.subject.description) {
        ws.getCell(r, 1).value = sub.subject.description;
        ws.mergeCells(r, 1, r, 5);
        ws.getRow(r).alignment = { wrapText: true, vertical: "top" };
        ws.getRow(r).height = 60;
        r++;
      }
      // Single header row, then a labeled block per non-empty resource type.
      ws.getRow(r).values = ["Call No. / ISSN", "Author", "Title", "Year", "Copy"];
      ws.getRow(r).font = { bold: true };
      r++;
      for (const t of NON_EMPTY_TYPES(sub.buckets)) {
        ws.getCell(r, 1).value = t.sectionLabel;
        ws.getRow(r).font = { italic: true };
        r++;
        for (const tt of sub.buckets[t.id]) {
          const ident = tt.call_no || tt.issn || "";
          ws.getRow(r).values = [ident, tt.author || "", tt.title || "", tt.year || "", tt.copies ?? 1];
          r++;
        }
      }
      const all = subjectTotals(sub.buckets);
      ws.getCell(r, 1).value = "Titles";
      ws.getCell(r, 2).value = all.titles;
      ws.getRow(r).font = { bold: true };
      r++;
      ws.getCell(r, 1).value = "Volumes";
      ws.getCell(r, 2).value = all.volumes;
      ws.getRow(r).font = { bold: true };
      r++;
      r++;
    }
  }
}

// ---------------------------------------------------------------------------
// CSV: flat per-row table tagged with resource type
// ---------------------------------------------------------------------------
export function programBibliographyCsv(b: ProgramBibliography): Buffer {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    [
      "Section", "Course Code", "Course Title", "Description",
      "Resource Type", "Call No.", "ISSN", "Author", "Title", "Year", "Copies",
    ].join(","),
  ];
  for (const sec of b.bySection) {
    for (const sub of sec.subjects) {
      for (const t of RESOURCE_TYPES) {
        for (const tt of sub.buckets[t.id]) {
          lines.push([
            sec.section, sub.subject.course_code, sub.subject.course_title,
            sub.subject.description, t.sectionLabel,
            tt.call_no, tt.issn, tt.author, tt.title, tt.year, tt.copies ?? 1,
          ].map(escape).join(","));
        }
      }
    }
  }
  return Buffer.from(lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------
export async function programBibliographyDocx(b: ProgramBibliography): Promise<Buffer> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, HeadingLevel, WidthType, TextRun } = await import("docx");

  const cell = (text: string, bold = false) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: text || "", bold })] })] });

  const headerRow = () => new TableRow({
    children: ["Call No. / ISSN", "Author", "Title", "Year", "Copy"].map((c) => cell(c, true)),
  });

  const children: import("docx").FileChild[] = [];
  children.push(new Paragraph({ text: "PALAWAN STATE UNIVERSITY", heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({ text: b.campus || "All Campuses" }));
  children.push(new Paragraph({ text: "Library Services" }));
  children.push(new Paragraph({ text: b.program.name, heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: "Professional Resources" }));

  for (const sec of b.bySection) {
    if (sec.section) children.push(new Paragraph({ text: sec.section, heading: HeadingLevel.HEADING_2 }));
    for (const sub of sec.subjects) {
      const heading = `${sub.subject.course_code ? sub.subject.course_code + " " : ""}${sub.subject.course_title}`;
      children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_3 }));
      if (sub.subject.description) children.push(new Paragraph({ text: sub.subject.description }));

      const rows: import("docx").TableRow[] = [headerRow()];
      for (const t of NON_EMPTY_TYPES(sub.buckets)) {
        rows.push(new TableRow({ children: [cell(t.sectionLabel, true), cell(""), cell(""), cell(""), cell("")] }));
        for (const tt of sub.buckets[t.id]) {
          const ident = tt.call_no || tt.issn || "";
          rows.push(new TableRow({
            children: [cell(ident), cell(tt.author || ""), cell(tt.title || ""), cell(tt.year || ""), cell(String(tt.copies ?? 1))],
          }));
        }
      }
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));

      const all = subjectTotals(sub.buckets);
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "Titles: ", bold: true }),
          new TextRun({ text: String(all.titles) }),
          new TextRun({ text: "   Volumes: ", bold: true }),
          new TextRun({ text: String(all.volumes) }),
        ],
      }));
      children.push(new Paragraph({ text: "" }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// PDF — bordered table layout that mirrors the DOCX
// ---------------------------------------------------------------------------
export async function programBibliographyPdf(b: ProgramBibliography): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const PAGE_BOTTOM = doc.page.height - doc.page.margins.bottom;
  const LEFT = doc.page.margins.left;
  const RIGHT = doc.page.width - doc.page.margins.right;
  const WIDTH = RIGHT - LEFT;
  // Column widths sum to WIDTH. Title gets the most space.
  const cols = [
    { key: "ident",  width: 0.16 * WIDTH },
    { key: "author", width: 0.18 * WIDTH },
    { key: "title",  width: 0.46 * WIDTH },
    { key: "year",   width: 0.08 * WIDTH },
    { key: "copy",   width: 0.06 * WIDTH },
  ];
  // pad row widths so they sum exactly to WIDTH (avoid float drift).
  const sumW = cols.reduce((a, c) => a + c.width, 0);
  cols[2].width += WIDTH - sumW;

  const colX = (idx: number) => LEFT + cols.slice(0, idx).reduce((a, c) => a + c.width, 0);

  function ensureSpace(needed: number) {
    if (doc.y + needed > PAGE_BOTTOM) doc.addPage();
  }

  function rowHeight(cells: string[], padding = 4): number {
    let h = 0;
    doc.fontSize(8);
    for (let i = 0; i < cells.length; i++) {
      const w = cols[i].width - padding * 2;
      const hi = doc.heightOfString(cells[i] || "", { width: w });
      if (hi > h) h = hi;
    }
    return h + padding * 2;
  }

  function drawRow(cells: string[], opts: { bold?: boolean; italic?: boolean; fillHeader?: boolean; merged?: boolean } = {}) {
    const padding = 4;
    const font = opts.bold ? "Helvetica-Bold" : opts.italic ? "Helvetica-Oblique" : "Helvetica";
    doc.font(font).fontSize(8);
    const h = opts.merged
      ? doc.heightOfString(cells[0] || "", { width: WIDTH - padding * 2 }) + padding * 2
      : rowHeight(cells, padding);
    ensureSpace(h);
    const y = doc.y;
    if (opts.fillHeader) doc.save().rect(LEFT, y, WIDTH, h).fill("#e8f0fa").restore();
    if (opts.merged) {
      doc.rect(LEFT, y, WIDTH, h).stroke();
      doc.text(cells[0] || "", LEFT + padding, y + padding, { width: WIDTH - padding * 2 });
    } else {
      for (let i = 0; i < cells.length; i++) {
        const x = colX(i);
        doc.rect(x, y, cols[i].width, h).stroke();
        doc.text(cells[i] || "", x + padding, y + padding, { width: cols[i].width - padding * 2 });
      }
    }
    doc.y = y + h;
  }

  // Header
  doc.font("Helvetica-Bold").fontSize(14).text("PALAWAN STATE UNIVERSITY", { align: "left" });
  doc.font("Helvetica").fontSize(10);
  doc.text(b.campus || "All Campuses");
  doc.text("Library Services");
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(13).text(b.program.name);
  doc.font("Helvetica-Oblique").fontSize(10).text("Professional Resources");
  doc.font("Helvetica");
  doc.moveDown(0.5);

  for (const sec of b.bySection) {
    if (sec.section) {
      ensureSpace(24);
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(11).text(sec.section);
      doc.font("Helvetica").fontSize(10);
    }
    for (const sub of sec.subjects) {
      ensureSpace(60);
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(10)
        .text(`${sub.subject.course_code ? sub.subject.course_code + "  " : ""}${sub.subject.course_title || ""}`);
      doc.font("Helvetica").fontSize(9);
      if (sub.subject.description) {
        doc.text(sub.subject.description, { width: WIDTH });
      }
      doc.moveDown(0.2);

      // Per-subject table: header row, then per-type label row + entries.
      drawRow(["Call No. / ISSN", "Author", "Title", "Year", "Copy"], { bold: true, fillHeader: true });
      for (const t of NON_EMPTY_TYPES(sub.buckets)) {
        drawRow([t.sectionLabel, "", "", "", ""], { italic: true, merged: true });
        for (const tt of sub.buckets[t.id]) {
          const ident = tt.call_no || tt.issn || "";
          drawRow([ident, tt.author || "", tt.title || "", tt.year || "", String(tt.copies ?? 1)]);
        }
      }
      const all = subjectTotals(sub.buckets);
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(9)
        .text(`Titles: ${all.titles}    Volumes: ${all.volumes}`);
      doc.font("Helvetica");
      doc.moveDown(0.3);
    }
  }

  doc.end();
  return done;
}
