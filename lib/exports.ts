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
  /** Journals matched anywhere in this program, deduplicated -- a
   *  subscription applies to the whole program, not one course, so these
   *  are listed once here instead of repeated under every subject that
   *  matched them (see loadProgramBibliography in lib/bibliography.ts). */
  journals: Buckets;
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
  // Volumes are a printed-material concept: only printed books / journals
  // contribute. Digital titles (eBooks, online journals) count toward titles
  // but not toward volumes.
  let titles = 0, volumes = 0;
  for (const t of RESOURCE_TYPES) {
    const sub = bucketTotals(buckets[t.id]);
    titles += sub.titles;
    if (t.medium === "print") volumes += sub.volumes;
  }
  return { titles, volumes };
}

/** Parse a year string like "2018", "c2018", "[2018]" → 2018. Unknown → null. */
function parseYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  if (y < 1000 || y > 9999) return null;
  return y;
}

/** Split subject totals into recent (<= 10 years from now) vs. older. Unknown year counts as old. */
function subjectTotalsByAge(buckets: Buckets, currentYear: number) {
  const cutoff = currentYear - 10;
  const recent = { titles: 0, volumes: 0 };
  const old = { titles: 0, volumes: 0 };
  for (const t of RESOURCE_TYPES) {
    for (const b of buckets[t.id]) {
      const y = parseYear(b.year);
      const isRecent = y !== null && y >= cutoff;
      const volumes = t.medium === "print" ? Math.max(1, b.copies ?? 1) : 0;
      const bucket = isRecent ? recent : old;
      bucket.titles += 1;
      bucket.volumes += volumes;
    }
  }
  return { recent, old };
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
  const currentYear = new Date().getFullYear();
  const cutoff = currentYear - 10;

  // Layout: Course Code | Course Title | Recent Titles | Recent Volumes |
  // Old Titles | Old Volumes | Total Titles | Total Volumes.
  // Recent / Old combine eBooks + printed books + journals (printed and
  // online). Volumes follow the existing rule: print = copies, digital = 1.
  ws.columns = [
    { width: 14 }, { width: 50 },
    { width: 16 }, { width: 16 },
    { width: 16 }, { width: 16 },
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
  ws.getCell(r++, 1).value =
    `Combined totals across eBooks, printed books, and journals. ` +
    `Recent = published ${cutoff}-${currentYear}; Older = before ${cutoff} or unknown year.`;
  ws.getRow(r - 1).font = { italic: true, size: 10 };
  r++;

  const header = [
    "Course Code", "Course Title",
    `Recent Titles (${cutoff}-${currentYear})`,
    "Recent Volumes",
    `Older Titles (< ${cutoff})`,
    "Older Volumes",
    "Total Titles", "Total Volumes",
  ];
  ws.getRow(r).values = header;
  ws.getRow(r).font = { bold: true };
  r++;

  const colTotals: number[] = Array(header.length - 2).fill(0);

  for (const sec of b.bySection) {
    if (sec.section) {
      ws.getCell(r, 2).value = sec.section;
      ws.getRow(r).font = { bold: true };
      r++;
    }
    for (const sub of sec.subjects) {
      const split = subjectTotalsByAge(sub.buckets, currentYear);
      const all = subjectTotals(sub.buckets);
      const cells: (string | number)[] = [
        sub.subject.course_code || "",
        sub.subject.course_title || "",
        split.recent.titles,
        split.recent.volumes,
        split.old.titles,
        split.old.volumes,
        all.titles,
        all.volumes,
      ];
      ws.getRow(r).values = cells;
      for (let i = 0; i < colTotals.length; i++) {
        colTotals[i] += Number(cells[i + 2]) || 0;
      }
      r++;
    }
  }

  const journalTotals = subjectTotals(b.journals);
  if (journalTotals.titles > 0) {
    const journalSplit = subjectTotalsByAge(b.journals, currentYear);
    const journalCells: (string | number)[] = [
      "", "Journals (program-wide, all courses)",
      journalSplit.recent.titles, journalSplit.recent.volumes,
      journalSplit.old.titles, journalSplit.old.volumes,
      journalTotals.titles, journalTotals.volumes,
    ];
    ws.getRow(r).values = journalCells;
    ws.getRow(r).font = { italic: true };
    for (let i = 0; i < colTotals.length; i++) {
      colTotals[i] += Number(journalCells[i + 2]) || 0;
    }
    r++;
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
    { width: 20 }, { width: 30 }, { width: 60 }, { width: 30 }, { width: 8 }, { width: 8 }, { width: 30 },
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
        ws.mergeCells(r, 1, r, 7);
        ws.getRow(r).alignment = { wrapText: true, vertical: "top" };
        ws.getRow(r).height = 60;
        r++;
      }
      // Single header row, then a labeled block per non-empty resource type.
      ws.getRow(r).values = ["Call No. / ISSN", "Author", "Title", "Publisher", "Year", "Copy", "Link"];
      ws.getRow(r).font = { bold: true };
      r++;
      for (const t of NON_EMPTY_TYPES(sub.buckets)) {
        ws.getCell(r, 1).value = t.sectionLabel;
        ws.getRow(r).font = { italic: true };
        r++;
        for (const tt of sub.buckets[t.id]) {
          const ident = tt.call_no || tt.issn || "";
          ws.getRow(r).values = [ident, tt.author || "", tt.title || "", tt.publisher || "", tt.year || "", tt.copies ?? 1];
          if (tt.url) ws.getCell(r, 7).value = { text: tt.url, hyperlink: tt.url };
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

  if (NON_EMPTY_TYPES(b.journals).length > 0) {
    ws.getCell(r, 2).value = "Journals (program-wide -- applies to every course, not repeated per course)";
    ws.getRow(r).font = { bold: true };
    r++;
    ws.getRow(r).values = ["Call No. / ISSN", "Author", "Title", "Publisher", "Year", "Copy", "Link"];
    ws.getRow(r).font = { bold: true };
    r++;
    for (const t of NON_EMPTY_TYPES(b.journals)) {
      ws.getCell(r, 1).value = t.sectionLabel;
      ws.getRow(r).font = { italic: true };
      r++;
      for (const tt of b.journals[t.id]) {
        const ident = tt.call_no || tt.issn || "";
        ws.getRow(r).values = [ident, tt.author || "", tt.title || "", tt.publisher || "", tt.year || "", tt.copies ?? 1];
        if (tt.url) ws.getCell(r, 7).value = { text: tt.url, hyperlink: tt.url };
        r++;
      }
    }
    const all = subjectTotals(b.journals);
    ws.getCell(r, 1).value = "Titles";
    ws.getCell(r, 2).value = all.titles;
    ws.getRow(r).font = { bold: true };
    r++;
    ws.getCell(r, 1).value = "Volumes";
    ws.getCell(r, 2).value = all.volumes;
    ws.getRow(r).font = { bold: true };
    r++;
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
      "Resource Type", "Call No.", "ISSN", "Author", "Title", "Publisher", "Year", "Copies", "Link",
    ].join(","),
  ];
  for (const sec of b.bySection) {
    for (const sub of sec.subjects) {
      for (const t of RESOURCE_TYPES) {
        for (const tt of sub.buckets[t.id]) {
          lines.push([
            sec.section, sub.subject.course_code, sub.subject.course_title,
            sub.subject.description, t.sectionLabel,
            tt.call_no, tt.issn, tt.author, tt.title, tt.publisher, tt.year, tt.copies ?? 1, tt.url ?? "",
          ].map(escape).join(","));
        }
      }
    }
  }
  // Journals apply to the whole program, not one course -- listed once
  // here (blank course code/title) instead of repeated per subject.
  for (const t of RESOURCE_TYPES) {
    for (const tt of b.journals[t.id]) {
      lines.push([
        "", "", "(Program-wide)",
        "", t.sectionLabel,
        tt.call_no, tt.issn, tt.author, tt.title, tt.publisher, tt.year, tt.copies ?? 1, tt.url ?? "",
      ].map(escape).join(","));
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
    HeadingLevel, WidthType, TextRun, ExternalHyperlink,
  } = await import("docx");

  // Column widths in DXA (twips). Sum = 9000 = full page width inside margins.
  // [Call No./ISSN, Author, Title, Publisher, Year, Copy, Link]
  const COL_DXA = [1200, 1300, 2400, 1400, 600, 500, 1600];
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

  const linkCell = (url: string | undefined, widthDxa: number) =>
    new TableCell({
      width: { size: widthDxa, type: WidthType.DXA },
      children: [new Paragraph({
        children: url
          ? [new ExternalHyperlink({ link: url, children: [new TextRun({ text: url, style: "Hyperlink" })] })]
          : [],
      })],
    });

  const subjectHeaderRow = (code: string, title: string) => new TableRow({
    children: [
      cell(code, { bold: true, widthDxa: COL_DXA[0] }),
      cell(title, { bold: true, colSpan: COL_DXA.length - 1, widthDxa: TOTAL_DXA - COL_DXA[0] }),
    ],
  });

  const descriptionRow = (desc: string) => new TableRow({
    children: [cell(desc, { colSpan: COL_DXA.length, widthDxa: TOTAL_DXA })],
  });

  const columnHeaderRow = () => new TableRow({
    tableHeader: true,
    children: ["Call No. / ISSN", "Author", "Title", "Publisher", "Year", "Copy", "Link"].map((c, i) =>
      cell(c, { bold: true, widthDxa: COL_DXA[i] }),
    ),
  });

  const typeLabelRow = (label: string) => new TableRow({
    children: [cell(label, { italic: true, colSpan: COL_DXA.length, widthDxa: TOTAL_DXA })],
  });

  const dataRow = (vals: string[], url: string | undefined) => new TableRow({
    children: [
      ...vals.map((v, i) => cell(v, { widthDxa: COL_DXA[i] })),
      linkCell(url, COL_DXA[COL_DXA.length - 1]),
    ],
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
          rows.push(dataRow([ident, tt.author || "", tt.title || "", tt.publisher || "", tt.year || "", String(tt.copies ?? 1)], tt.url));
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

  if (NON_EMPTY_TYPES(b.journals).length > 0) {
    children.push(new Paragraph({ text: "Journals (program-wide -- applies to every course, not repeated per course)", heading: HeadingLevel.HEADING_2 }));
    const journalRows: import("docx").TableRow[] = [columnHeaderRow()];
    for (const t of NON_EMPTY_TYPES(b.journals)) {
      journalRows.push(typeLabelRow(t.sectionLabel));
      for (const tt of b.journals[t.id]) {
        const ident = tt.call_no || tt.issn || "";
        journalRows.push(dataRow([ident, tt.author || "", tt.title || "", tt.publisher || "", tt.year || "", String(tt.copies ?? 1)], tt.url));
      }
    }
    children.push(new Table({
      width: { size: TOTAL_DXA, type: WidthType.DXA },
      columnWidths: COL_DXA,
      rows: journalRows,
    }));
    const journalTotals = subjectTotals(b.journals);
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "Titles: ", bold: true }),
        new TextRun({ text: String(journalTotals.titles) }),
        new TextRun({ text: "   Volumes: ", bold: true }),
        new TextRun({ text: String(journalTotals.volumes) }),
      ],
    }));
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// PDF — first the Summary table (same shape as the `sum` Excel sheet),
// then per-subject Detail blocks (same shape as the `Detail` sheet).
// ---------------------------------------------------------------------------
export async function programBibliographyPdf(b: ProgramBibliography): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const LEFT = doc.page.margins.left;
  const RIGHT = doc.page.width - doc.page.margins.right;
  const WIDTH = RIGHT - LEFT;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

  function ensureSpace(needed: number) {
    if (doc.y + needed > pageBottom()) doc.addPage();
  }

  function programHeader(subtitle: string) {
    doc.font("Helvetica-Bold").fontSize(14).text("PALAWAN STATE UNIVERSITY", { align: "left" });
    doc.font("Helvetica").fontSize(10);
    doc.text(b.campus || "All Campuses");
    doc.text("Library Services");
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(12).text(b.program.name);
    doc.font("Helvetica-Oblique").fontSize(10).text(subtitle);
    doc.font("Helvetica");
    doc.moveDown(0.4);
  }

  // -------------------- Page 1: Summary table (mirrors `sum` sheet) ----------
  programHeader("Summary of Professional Resources");

  type SumCol = { label1: string; label2: string; width: number };
  const sumCols: SumCol[] = [
    { label1: "Course Code", label2: "",       width: 60 },
    { label1: "Course Title", label2: "",      width: 200 },
  ];
  for (const t of RESOURCE_TYPES) {
    sumCols.push({ label1: t.sectionLabel, label2: "Titles", width: t.medium === "print" ? 45 : 60 });
    if (t.medium === "print") sumCols.push({ label1: "", label2: "Volumes", width: 45 });
  }
  sumCols.push({ label1: "Total", label2: "Titles", width: 50 });
  sumCols.push({ label1: "Total", label2: "Volumes", width: 55 });

  // Scale column widths to page width.
  const totalRequested = sumCols.reduce((a, c) => a + c.width, 0);
  const scale = WIDTH / totalRequested;
  for (const c of sumCols) c.width *= scale;

  const sumColX = (idx: number) => LEFT + sumCols.slice(0, idx).reduce((a, c) => a + c.width, 0);

  function drawSumRow(values: (string | number)[], opts: { header?: boolean; bold?: boolean } = {}) {
    const padding = 3;
    const cellHeight = opts.header ? 24 : 14;
    ensureSpace(cellHeight);
    const y = doc.y;
    doc.font(opts.bold || opts.header ? "Helvetica-Bold" : "Helvetica").fontSize(7);
    if (opts.header) {
      doc.save().rect(LEFT, y, WIDTH, cellHeight).fill("#e8f0fa").restore();
    }
    for (let i = 0; i < sumCols.length; i++) {
      const x = sumColX(i);
      doc.rect(x, y, sumCols[i].width, cellHeight).stroke();
      doc.text(String(values[i] ?? ""), x + padding, y + padding, {
        width: sumCols[i].width - padding * 2, height: cellHeight - padding * 2, ellipsis: true,
      });
    }
    doc.y = y + cellHeight;
  }

  // Two header rows: first is the type/category, second is Titles/Volumes.
  drawSumRow(sumCols.map((c) => c.label1), { header: true });
  drawSumRow(sumCols.map((c) => c.label2), { header: true });

  // Running totals per column for the Program Totals row.
  const colTotals = sumCols.map(() => 0);

  for (const sec of b.bySection) {
    if (sec.section) {
      ensureSpace(16);
      doc.font("Helvetica-Bold").fontSize(8)
        .fillColor("#1f4e79").text(sec.section, LEFT, doc.y + 2);
      doc.fillColor("black").font("Helvetica");
      doc.y += 16;
    }
    for (const sub of sec.subjects) {
      const row: (string | number)[] = [sub.subject.course_code || "", sub.subject.course_title || ""];
      let colIdx = 2;
      for (const t of RESOURCE_TYPES) {
        const tot = bucketTotals(sub.buckets[t.id]);
        row.push(tot.titles);
        colTotals[colIdx] += tot.titles; colIdx++;
        if (t.medium === "print") {
          row.push(tot.volumes);
          colTotals[colIdx] += tot.volumes; colIdx++;
        }
      }
      const all = subjectTotals(sub.buckets);
      row.push(all.titles, all.volumes);
      colTotals[colIdx] += all.titles; colIdx++;
      colTotals[colIdx] += all.volumes;
      drawSumRow(row);
    }
  }

  doc.moveDown(0.3);
  drawSumRow(
    ["Program Totals", "", ...colTotals.slice(2)],
    { bold: true },
  );

  // -------------------- Subsequent pages: Detail blocks ----------------------
  doc.addPage();
  programHeader("Professional Resources — Detail");

  // Switch to portrait-ish proportions inside landscape; reuse layout.
  // [Call No./ISSN, Author, Title, Publisher, Year, Copy, Link]
  const cols = [
    { width: 0.13 * WIDTH },
    { width: 0.14 * WIDTH },
    { width: 0.24 * WIDTH },
    { width: 0.15 * WIDTH },
    { width: 0.06 * WIDTH },
    { width: 0.05 * WIDTH },
    { width: 0.19 * WIDTH },
  ];
  const driftSum = cols.reduce((a, c) => a + c.width, 0);
  cols[2].width += WIDTH - driftSum;
  const colX = (idx: number) => LEFT + cols.slice(0, idx).reduce((a, c) => a + c.width, 0);

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
      // Subject heading row: course code in col 1, course title spanning the
      // rest. This matches the XLSX detail sheet (course_code in col A,
      // title in col B) instead of floating as plain text above the table.
      drawSubjectHeaderRow(sub.subject.course_code || "", sub.subject.course_title || "");
      if (sub.subject.description) {
        drawRow([sub.subject.description, "", "", "", "", "", ""], { merged: true });
      }

      // Column header row + per-type label row + entries.
      drawRow(["Call No. / ISSN", "Author", "Title", "Publisher", "Year", "Copy", "Link"], { bold: true, fillHeader: true });
      for (const t of NON_EMPTY_TYPES(sub.buckets)) {
        drawRow([t.sectionLabel, "", "", "", "", "", ""], { italic: true, merged: true });
        for (const tt of sub.buckets[t.id]) {
          const ident = tt.call_no || tt.issn || "";
          drawRow([ident, tt.author || "", tt.title || "", tt.publisher || "", tt.year || "", String(tt.copies ?? 1), tt.url || ""]);
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

  if (NON_EMPTY_TYPES(b.journals).length > 0) {
    ensureSpace(24);
    doc.x = LEFT;
    doc.moveDown(0.4);
    doc.fillColor("black");
    doc.font("Helvetica-Bold").fontSize(11)
      .text("Journals (program-wide -- applies to every course, not repeated per course)", LEFT, doc.y, { width: WIDTH });
    doc.font("Helvetica").fontSize(10);
    doc.moveDown(0.2);

    drawRow(["Call No. / ISSN", "Author", "Title", "Publisher", "Year", "Copy", "Link"], { bold: true, fillHeader: true });
    for (const t of NON_EMPTY_TYPES(b.journals)) {
      drawRow([t.sectionLabel, "", "", "", "", "", ""], { italic: true, merged: true });
      for (const tt of b.journals[t.id]) {
        const ident = tt.call_no || tt.issn || "";
        drawRow([ident, tt.author || "", tt.title || "", tt.publisher || "", tt.year || "", String(tt.copies ?? 1), tt.url || ""]);
      }
    }
    const journalTotals = subjectTotals(b.journals);
    doc.x = LEFT;
    doc.moveDown(0.2);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black")
      .text(`Titles: ${journalTotals.titles}    Volumes: ${journalTotals.volumes}`, LEFT, doc.y, { width: WIDTH });
    doc.font("Helvetica");
    doc.x = LEFT;
    doc.moveDown(0.3);
  }

  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Citations export — APA / MLA / Chicago / Harvard formatted bibliography
// grouped by subject. Produced as DOCX (printable) or plain text.
// ---------------------------------------------------------------------------
import { formatCitation } from "./citations";
import type { CitationStyle } from "./types";

export async function programCitationsDocx(
  b: ProgramBibliography,
  style: CitationStyle = "apa7",
): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");

  const children: import("docx").FileChild[] = [];
  children.push(new Paragraph({ text: "PALAWAN STATE UNIVERSITY", heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({ text: b.campus || "All Campuses" }));
  children.push(new Paragraph({ text: "Library Services" }));
  children.push(new Paragraph({ text: b.program.name, heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Reading list — ${style.toUpperCase()} style`, italics: true })] }));

  for (const sec of b.bySection) {
    if (sec.section) children.push(new Paragraph({ text: sec.section, heading: HeadingLevel.HEADING_2 }));
    for (const sub of sec.subjects) {
      const heading = `${sub.subject.course_code ? sub.subject.course_code + " " : ""}${sub.subject.course_title}`;
      children.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_3 }));
      if (sub.subject.description) {
        children.push(new Paragraph({ children: [new TextRun({ text: sub.subject.description, italics: true })] }));
      }
      const lines: string[] = [];
      for (const t of RESOURCE_TYPES) {
        for (const tt of sub.buckets[t.id]) lines.push(formatCitation(tt, style));
      }
      if (lines.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "No assigned resources.", italics: true, color: "808080" })] }));
      } else {
        // Sort alphabetically by author/title-ish (each line already starts with author).
        lines.sort((a, c) => a.localeCompare(c));
        for (const line of lines) {
          children.push(new Paragraph({ text: line, spacing: { after: 120 } }));
        }
      }
      children.push(new Paragraph({ text: "" }));
    }
  }

  const journalLines: string[] = [];
  for (const t of RESOURCE_TYPES) {
    for (const tt of b.journals[t.id]) journalLines.push(formatCitation(tt, style));
  }
  if (journalLines.length > 0) {
    children.push(new Paragraph({ text: "Journals (program-wide -- applies to every course, not repeated per course)", heading: HeadingLevel.HEADING_2 }));
    journalLines.sort((a, c) => a.localeCompare(c));
    for (const line of journalLines) {
      children.push(new Paragraph({ text: line, spacing: { after: 120 } }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}

export function programCitationsTxt(
  b: ProgramBibliography,
  style: CitationStyle = "apa7",
): Buffer {
  const out: string[] = [];
  out.push("PALAWAN STATE UNIVERSITY");
  out.push(b.campus || "All Campuses");
  out.push("Library Services");
  out.push("");
  out.push(b.program.name);
  out.push(`Reading list — ${style.toUpperCase()} style`);
  out.push("");
  for (const sec of b.bySection) {
    if (sec.section) { out.push(""); out.push(sec.section.toUpperCase()); out.push(""); }
    for (const sub of sec.subjects) {
      out.push("");
      out.push(`${sub.subject.course_code ? sub.subject.course_code + " " : ""}${sub.subject.course_title}`);
      if (sub.subject.description) out.push(sub.subject.description);
      out.push("");
      const lines: string[] = [];
      for (const t of RESOURCE_TYPES) {
        for (const tt of sub.buckets[t.id]) lines.push(formatCitation(tt, style));
      }
      lines.sort((a, c) => a.localeCompare(c));
      if (lines.length === 0) out.push("  (no assigned resources)");
      else for (const l of lines) out.push("  • " + l);
    }
  }
  const journalLines: string[] = [];
  for (const t of RESOURCE_TYPES) {
    for (const tt of b.journals[t.id]) journalLines.push(formatCitation(tt, style));
  }
  if (journalLines.length > 0) {
    out.push("");
    out.push("JOURNALS (program-wide -- applies to every course, not repeated per course)");
    out.push("");
    journalLines.sort((a, c) => a.localeCompare(c));
    for (const l of journalLines) out.push("  • " + l);
  }
  return Buffer.from(out.join("\n"), "utf-8");
}
