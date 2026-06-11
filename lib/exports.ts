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
  const {
    Document, Packer, Paragraph, Table, TableCell, TableRow,
    HeadingLevel, WidthType, TextRun,
  } = await import("docx");

  // Column widths in DXA (twips). Sum = 9000 = full page width inside margins.
  const COL_DXA = [1500, 1700, 4300, 800, 700];
  const TOTAL_DXA = COL_DXA.reduce((a, c) => a + c, 0);

  const cell = (
    text: string,
    opts: { bold?: boolean; italic?: boolean; colSpan?: number; widthDxa?: number } = {},
  ) => new TableCell({
    width: opts.widthDxa
      ? { size: opts.widthDxa, type: WidthType.DXA }
      : undefined,
    columnSpan: opts.colSpan,
    children: [new Paragraph({
      children: [new TextRun({ text: text || "", bold: opts.bold, italics: opts.italic })],
    })],
  });

  const subjectHeaderRow = (code: string, title: string) => new TableRow({
    children: [
      cell(code, { bold: true, widthDxa: COL_DXA[0] }),
      cell(title, { bold: true, colSpan: 4, widthDxa: TOTAL_DXA - COL_DXA[0] }),
    ],
  });

  const descriptionRow = (desc: string) => new TableRow({
    children: [cell(desc, { colSpan: 5, widthDxa: TOTAL_DXA })],
  });

  const columnHeaderRow = () => new TableRow({
    tableHeader: true,
    children: ["Call No. / ISSN", "Author", "Title", "Year", "Copy"].map((c, i) =>
      cell(c, { bold: true, widthDxa: COL_DXA[i] }),
    ),
  });

  const typeLabelRow = (label: string) => new TableRow({
    children: [cell(label, { italic: true, colSpan: 5, widthDxa: TOTAL_DXA })],
  });

  const dataRow = (vals: string[]) => new TableRow({
    children: vals.map((v, i) => cell(v, { widthDxa: COL_DXA[i] })),
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
      const rows: import("docx").TableRow[] = [];
      rows.push(subjectHeaderRow(sub.subject.course_code || "", sub.subject.course_title || ""));
      if (sub.subject.description) rows.push(descriptionRow(sub.subject.description));
      rows.push(columnHeaderRow());
      for (const t of NON_EMPTY_TYPES(sub.buckets)) {
        rows.push(typeLabelRow(t.sectionLabel));
        for (const tt of sub.buckets[t.id]) {
          const ident = tt.call_no || tt.issn || "";
          rows.push(dataRow([ident, tt.author || "", tt.title || "", tt.year || "", String(tt.copies ?? 1)]));
        }
      }
      children.push(new Table({
        width: { size: TOTAL_DXA, type: WidthType.DXA },
        columnWidths: COL_DXA,
        rows,
      }));

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

  // Two-cell row used for the subject heading: course code (col 0 width) +
  // course title spanning the remaining columns. Mirrors the XLSX layout.
  function drawSubjectHeaderRow(code: string, title: string) {
    const padding = 4;
    doc.font("Helvetica-Bold").fontSize(9);
    const leftW = cols[0].width;
    const rightW = WIDTH - leftW;
    const hLeft = doc.heightOfString(code || "", { width: leftW - padding * 2 });
    const hRight = doc.heightOfString(title || "", { width: rightW - padding * 2 });
    const h = Math.max(hLeft, hRight) + padding * 2;
    ensureSpace(h);
    const y = doc.y;
    doc.rect(LEFT, y, WIDTH, h).fillColor("#f4f6fb").fill();
    doc.fillColor("black");
    doc.rect(LEFT, y, leftW, h).strokeColor("black").stroke();
    doc.text(code || "", LEFT + padding, y + padding, { width: leftW - padding * 2 });
    doc.rect(LEFT + leftW, y, rightW, h).stroke();
    doc.text(title || "", LEFT + leftW + padding, y + padding, { width: rightW - padding * 2 });
    doc.x = LEFT;
    doc.y = y + h;
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
    if (opts.fillHeader) {
      doc.rect(LEFT, y, WIDTH, h).fillColor("#e8f0fa").fill();
    }
    // Always reset the text/stroke colors before drawing borders and text so
    // a previous fill() doesn't leak into the next row.
    doc.fillColor("black").strokeColor("black");
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
    doc.x = LEFT;
    doc.y = y + h;
  }

  // Header
  doc.fillColor("black").strokeColor("black");
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
      doc.x = LEFT;
      doc.moveDown(0.4);
      doc.fillColor("black");
      doc.font("Helvetica-Bold").fontSize(11).text(sec.section, LEFT, doc.y, { width: WIDTH });
      doc.font("Helvetica").fontSize(10);
    }
    for (const sub of sec.subjects) {
      ensureSpace(60);
      doc.moveDown(0.4);

      // Subject heading row: course code in col 1, course title spanning cols 2-5.
      // This matches the XLSX detail sheet (course_code in col A, title in col B).
      drawSubjectHeaderRow(sub.subject.course_code || "", sub.subject.course_title || "");
      if (sub.subject.description) {
        drawRow([sub.subject.description, "", "", "", ""], { merged: true });
      }

      // Column header row + per-type label row + entries.
      drawRow(["Call No. / ISSN", "Author", "Title", "Year", "Copy"], { bold: true, fillHeader: true });
      for (const t of NON_EMPTY_TYPES(sub.buckets)) {
        drawRow([t.sectionLabel, "", "", "", ""], { italic: true, merged: true });
        for (const tt of sub.buckets[t.id]) {
          const ident = tt.call_no || tt.issn || "";
          drawRow([ident, tt.author || "", tt.title || "", tt.year || "", String(tt.copies ?? 1)]);
        }
      }
      const all = subjectTotals(sub.buckets);
      doc.x = LEFT;
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("black")
        .text(`Titles: ${all.titles}    Volumes: ${all.volumes}`, LEFT, doc.y, { width: WIDTH });
      doc.font("Helvetica");
      doc.x = LEFT;
      doc.moveDown(0.3);
    }
  }

  doc.end();
  return done;
}
