import type { RecommendationRow } from "./types";

const COLS: (keyof RecommendationRow)[] = [
  "Campus", "College", "Program", "Course",
  "Book Title", "Author", "Publication Year", "Publisher", "Number of Copies",
];

function sortRows(rows: RecommendationRow[]): RecommendationRow[] {
  return [...rows].sort((a, b) => {
    for (const k of ["Campus", "College", "Program", "Course", "Book Title"] as const) {
      const cmp = String(a[k]).localeCompare(String(b[k]));
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

export async function toXlsx(rows: RecommendationRow[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Recommendations");
  ws.addRow(COLS);
  for (const r of sortRows(rows)) ws.addRow(COLS.map((c) => r[c]));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col) => { col.width = 24; });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function toCsv(rows: RecommendationRow[]): Buffer {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLS.join(",")];
  for (const r of sortRows(rows)) lines.push(COLS.map((c) => escape(r[c])).join(","));
  return Buffer.from(lines.join("\n"), "utf-8");
}

export async function toPdf(rows: RecommendationRow[]): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(16).text("Library Acquisition Recommendations", { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(8);

  const widths = [70, 100, 110, 110, 140, 80, 50, 80, 50];
  const startX = doc.x;
  let y = doc.y;
  const drawRow = (cells: string[], bold = false) => {
    let x = startX;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica");
    cells.forEach((c, i) => {
      doc.text(String(c), x + 2, y + 2, { width: widths[i] - 4, height: 22, ellipsis: true });
      doc.rect(x, y, widths[i], 22).stroke();
      x += widths[i];
    });
    y += 22;
    if (y > doc.page.height - 40) { doc.addPage(); y = doc.y; }
  };

  drawRow(COLS, true);
  for (const r of sortRows(rows)) drawRow(COLS.map((c) => String(r[c])));
  doc.end();
  return done;
}

export async function toDocx(rows: RecommendationRow[]): Promise<Buffer> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, HeadingLevel, WidthType } = await import("docx");
  const sorted = sortRows(rows);
  const header = new TableRow({
    children: COLS.map((c) => new TableCell({ children: [new Paragraph({ text: String(c) })] })),
  });
  const bodyRows = sorted.map((r) =>
    new TableRow({
      children: COLS.map((c) => new TableCell({ children: [new Paragraph({ text: String(r[c]) })] })),
    }),
  );
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...bodyRows],
  });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Library Acquisition Recommendations", heading: HeadingLevel.HEADING_1 }),
        table,
      ],
    }],
  });
  return await Packer.toBuffer(doc);
}
