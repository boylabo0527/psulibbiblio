/**
 * Per-program bibliography export shaped to match the BA_PolSci_100725
 * template:
 *
 * Sheet "sum":
 *   - Header rows (campus, program, "Summary of Professional Books")
 *   - Table: section header rows + per-subject rows
 *     [Course Code | Course Title | PrintTitles | PrintVols | eBookTitles | TotalTitles | TotalVols]
 *
 * Sheet "Detail":
 *   - Per-subject blocks:
 *       Course Code | Course Title
 *       Description
 *       Call No. | Author | Title | Year | Copy
 *       eBooks (Kavita)
 *         ... ebook rows ...
 *       Printed Books
 *         ... printed rows ...
 *       Titles  | <count>
 *       Volumes | <count>
 */
import type { TitleRow, SubjectRow, ProgramRow } from "./types";

export type AssignmentDetail = {
  subject: SubjectRow;
  ebooks: TitleRow[];
  printed: TitleRow[];
};

export type ProgramBibliography = {
  program: ProgramRow;
  bySection: { section: string; subjects: AssignmentDetail[] }[];
};

function totals(books: TitleRow[]) {
  let titles = 0;
  let volumes = 0;
  for (const b of books) {
    titles += 1;
    volumes += Math.max(1, b.copies ?? 1);
  }
  return { titles, volumes };
}

export async function programBibliographyXlsx(b: ProgramBibliography): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PSU Bibliography Generator";

  writeSummarySheet(wb, b);
  writeDetailSheet(wb, b);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function writeSummarySheet(wb: import("exceljs").Workbook, b: ProgramBibliography) {
  const ws = wb.addWorksheet("sum");
  ws.columns = [
    { width: 14 }, { width: 60 }, { width: 10 }, { width: 12 },
    { width: 10 }, { width: 10 }, { width: 12 },
  ];

  let r = 1;
  ws.getCell(r++, 1).value = "PALAWAN STATE UNIVERSITY";
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = b.program.campus || "";
  ws.getCell(r++, 1).value = b.program.college || "Library Services";
  r++;
  ws.getCell(r++, 1).value = b.program.name;
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = "Summary of Professional Books";
  ws.getRow(r - 1).font = { italic: true };
  r++;

  const header1 = ["Professional Subject", "", "Printed books", "", "eBooks", "Total", ""];
  const header2 = ["", "", "Titles", "Volumes", "Titles", "Titles", "Volumes"];
  ws.getRow(r).values = header1;
  ws.getRow(r).font = { bold: true };
  r++;
  ws.getRow(r).values = header2;
  ws.getRow(r).font = { bold: true };
  ws.mergeCells(r - 1, 3, r - 1, 4);
  ws.mergeCells(r - 1, 6, r - 1, 7);
  r++;

  let progPrintTitles = 0, progPrintVols = 0, progEbookTitles = 0;
  for (const sec of b.bySection) {
    if (sec.section) {
      ws.getCell(r, 2).value = sec.section;
      ws.getRow(r).font = { bold: true };
      r++;
    }
    for (const sub of sec.subjects) {
      const print = totals(sub.printed);
      const ebook = totals(sub.ebooks);
      const totTitles = print.titles + ebook.titles;
      const totVols = print.volumes + ebook.titles; // eBook volumes count = titles
      ws.getRow(r).values = [
        sub.subject.course_code || "",
        sub.subject.course_title || "",
        print.titles, print.volumes,
        ebook.titles,
        totTitles, totVols,
      ];
      progPrintTitles += print.titles;
      progPrintVols += print.volumes;
      progEbookTitles += ebook.titles;
      r++;
    }
  }

  r++;
  ws.getCell(r, 1).value = "Program Totals";
  ws.getRow(r).font = { bold: true };
  ws.getCell(r, 3).value = progPrintTitles;
  ws.getCell(r, 4).value = progPrintVols;
  ws.getCell(r, 5).value = progEbookTitles;
  ws.getCell(r, 6).value = progPrintTitles + progEbookTitles;
  ws.getCell(r, 7).value = progPrintVols + progEbookTitles;
}

function writeDetailSheet(wb: import("exceljs").Workbook, b: ProgramBibliography) {
  const ws = wb.addWorksheet("Detail");
  ws.columns = [
    { width: 20 }, { width: 30 }, { width: 60 }, { width: 8 }, { width: 8 },
  ];

  let r = 1;
  ws.getCell(r++, 1).value = "PALAWAN STATE UNIVERSITY";
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = b.program.campus || "";
  ws.getCell(r++, 1).value = b.program.college || "Library Services";
  r++;
  ws.getCell(r++, 1).value = b.program.name;
  ws.getRow(r - 1).font = { bold: true };
  ws.getCell(r++, 1).value = "Professional Books";
  ws.getRow(r - 1).font = { italic: true };
  r++;

  for (const sec of b.bySection) {
    if (sec.section) {
      ws.getCell(r, 1).value = sec.section;
      ws.getRow(r).font = { bold: true };
      r++;
    }

    for (const sub of sec.subjects) {
      // Course code | Title
      ws.getCell(r, 1).value = sub.subject.course_code || "";
      ws.getCell(r, 2).value = sub.subject.course_title || "";
      ws.getRow(r).font = { bold: true };
      r++;

      // Description (merged across columns)
      if (sub.subject.description) {
        ws.getCell(r, 1).value = sub.subject.description;
        ws.mergeCells(r, 1, r, 5);
        ws.getRow(r).alignment = { wrapText: true, vertical: "top" };
        ws.getRow(r).height = 60;
        r++;
      }

      // Column headers
      ws.getRow(r).values = ["Call No.", "Author", "Title", "Year", "Copy"];
      ws.getRow(r).font = { bold: true };
      r++;

      if (sub.ebooks.length) {
        ws.getCell(r, 1).value = "eBooks (Kavita)";
        ws.getRow(r).font = { italic: true };
        r++;
        for (const t of sub.ebooks) {
          ws.getRow(r).values = ["", t.author || "", t.title || "", t.year || "", t.copies ?? 1];
          r++;
        }
      }
      if (sub.printed.length) {
        ws.getCell(r, 1).value = "Printed Books";
        ws.getRow(r).font = { italic: true };
        r++;
        for (const t of sub.printed) {
          ws.getRow(r).values = [t.call_no || "", t.author || "", t.title || "", t.year || "", t.copies ?? 1];
          r++;
        }
      }

      const print = totals(sub.printed);
      const ebook = totals(sub.ebooks);
      ws.getCell(r, 1).value = "Titles";
      ws.getCell(r, 2).value = print.titles + ebook.titles;
      ws.getRow(r).font = { bold: true };
      r++;
      ws.getCell(r, 1).value = "Volumes";
      ws.getCell(r, 2).value = print.volumes + ebook.titles;
      ws.getRow(r).font = { bold: true };
      r++;
      r++; // blank spacer
    }
  }
}

// ---------------------------------------------------------------------------
// CSV / DOCX export of the same per-subject structure (flattened table).
// ---------------------------------------------------------------------------
export function programBibliographyCsv(b: ProgramBibliography): Buffer {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    [
      "Section", "Course Code", "Course Title", "Description",
      "Format", "Call No.", "Author", "Title", "Year", "Copies",
    ].join(","),
  ];
  for (const sec of b.bySection) {
    for (const sub of sec.subjects) {
      for (const fmt of ["ebook", "printed"] as const) {
        const list = fmt === "ebook" ? sub.ebooks : sub.printed;
        for (const t of list) {
          lines.push([
            sec.section, sub.subject.course_code, sub.subject.course_title,
            sub.subject.description, fmt, t.call_no, t.author, t.title, t.year, t.copies ?? 1,
          ].map(escape).join(","));
        }
      }
    }
  }
  return Buffer.from(lines.join("\n"), "utf-8");
}

export async function programBibliographyDocx(b: ProgramBibliography): Promise<Buffer> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, HeadingLevel, WidthType, TextRun } = await import("docx");

  const cell = (text: string, bold = false) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: text || "", bold })] })] });

  const headerRow = () => new TableRow({
    children: ["Call No.", "Author", "Title", "Year", "Copy"].map((c) => cell(c, true)),
  });

  const sections: import("docx").FileChild[] = [];
  sections.push(new Paragraph({ text: b.program.name, heading: HeadingLevel.HEADING_1 }));
  if (b.program.campus) sections.push(new Paragraph({ text: b.program.campus }));
  if (b.program.college) sections.push(new Paragraph({ text: b.program.college }));

  for (const sec of b.bySection) {
    if (sec.section) sections.push(new Paragraph({ text: sec.section, heading: HeadingLevel.HEADING_2 }));
    for (const sub of sec.subjects) {
      const heading = `${sub.subject.course_code ? sub.subject.course_code + " " : ""}${sub.subject.course_title}`;
      sections.push(new Paragraph({ text: heading, heading: HeadingLevel.HEADING_3 }));
      if (sub.subject.description) sections.push(new Paragraph({ text: sub.subject.description }));

      const rows: import("docx").TableRow[] = [headerRow()];
      if (sub.ebooks.length) {
        rows.push(new TableRow({ children: [cell("eBooks (Kavita)", true), cell(""), cell(""), cell(""), cell("")] }));
        for (const t of sub.ebooks) {
          rows.push(new TableRow({
            children: [cell(""), cell(t.author || ""), cell(t.title || ""), cell(t.year || ""), cell(String(t.copies ?? 1))],
          }));
        }
      }
      if (sub.printed.length) {
        rows.push(new TableRow({ children: [cell("Printed Books", true), cell(""), cell(""), cell(""), cell("")] }));
        for (const t of sub.printed) {
          rows.push(new TableRow({
            children: [cell(t.call_no || ""), cell(t.author || ""), cell(t.title || ""), cell(t.year || ""), cell(String(t.copies ?? 1))],
          }));
        }
      }
      sections.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
      const print = totals(sub.printed);
      const ebook = totals(sub.ebooks);
      sections.push(new Paragraph({
        children: [
          new TextRun({ text: "Titles: ", bold: true }),
          new TextRun({ text: String(print.titles + ebook.titles) }),
          new TextRun({ text: "   Volumes: ", bold: true }),
          new TextRun({ text: String(print.volumes + ebook.titles) }),
        ],
      }));
      sections.push(new Paragraph({ text: "" }));
    }
  }

  const doc = new Document({ sections: [{ children: sections }] });
  return await Packer.toBuffer(doc);
}

export async function programBibliographyPdf(b: ProgramBibliography): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(16).font("Helvetica-Bold").text(b.program.name);
  doc.fontSize(10).font("Helvetica");
  if (b.program.campus) doc.text(b.program.campus);
  if (b.program.college) doc.text(b.program.college);
  doc.moveDown();

  for (const sec of b.bySection) {
    if (sec.section) {
      doc.moveDown(0.5).fontSize(12).font("Helvetica-Bold").text(sec.section);
      doc.fontSize(10).font("Helvetica");
    }
    for (const sub of sec.subjects) {
      doc.moveDown(0.5).font("Helvetica-Bold")
        .text(`${sub.subject.course_code ? sub.subject.course_code + " — " : ""}${sub.subject.course_title}`);
      doc.font("Helvetica");
      if (sub.subject.description) doc.text(sub.subject.description, { width: 515 });
      const print = totals(sub.printed);
      const ebook = totals(sub.ebooks);

      if (sub.ebooks.length) {
        doc.moveDown(0.3).font("Helvetica-Oblique").text("eBooks (Kavita)");
        doc.font("Helvetica");
        for (const t of sub.ebooks) doc.text(`• ${t.author ? t.author + ". " : ""}${t.title} (${t.year || "n.d."})`);
      }
      if (sub.printed.length) {
        doc.moveDown(0.3).font("Helvetica-Oblique").text("Printed Books");
        doc.font("Helvetica");
        for (const t of sub.printed) doc.text(`• ${t.call_no ? `[${t.call_no}] ` : ""}${t.author ? t.author + ". " : ""}${t.title} (${t.year || "n.d."}) — ${t.copies ?? 1} copy`);
      }
      doc.moveDown(0.3).font("Helvetica-Bold").text(
        `Titles: ${print.titles + ebook.titles}    Volumes: ${print.volumes + ebook.titles}`,
      );
      doc.font("Helvetica");
    }
  }

  doc.end();
  return done;
}
