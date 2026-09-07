import * as XLSX from "xlsx";

export type PRItem = {
  stock_prop_no: string;
  unit: string;
  description: string;
  quantity: number;
  unit_cost: number;
};

export type PRData = {
  entityName: string;
  office: string;
  fundCluster: string;
  prNo: string;
  date: string;
  rcCode: string;
  purpose: string;
  requestedBy: string;
  approvedBy: string;
  items: PRItem[];
};

function cell(v: unknown, t?: "n" | "s"): XLSX.CellObject {
  return { v, t: t ?? (typeof v === "number" ? "n" : "s") } as XLSX.CellObject;
}

/** A numeric cell backed by a live formula (`f`, no leading "=") instead of
 *  a bare value -- `v` is still the current computed number, kept as the
 *  cached display value for viewers that don't recalculate on open. */
function formulaCell(formula: string, v: number): XLSX.CellObject {
  return { t: "n", v, f: formula } as XLSX.CellObject;
}

export function generatePurchaseRequestXlsx(data: PRData): Buffer {
  const { items } = data;

  // Build rows as AOA (array of arrays), 9 columns A-I
  const COLS = 9;
  const empty = (): unknown[] => Array(COLS).fill("");

  const rows: unknown[][] = [];

  // Row 1: title row (blank, header info is in row 2)
  rows.push(empty()); // index 0 — often a blank/logo row

  // Row 2 (index 1): Entity name + Fund Cluster
  const r2 = empty();
  r2[0] = `Entity Name: ${data.entityName || "PALAWAN STATE UNIVERSITY"}`;
  r2[7] = `Fund Cluster: ${data.fundCluster}`;
  rows.push(r2);

  // Row 3 (index 2): Office/Section + Date
  const r3 = empty();
  r3[0] = `Office/ Section: ${data.office}`;
  r3[7] = `Date: ${data.date}`;
  rows.push(r3);

  // Row 4 (index 3): PR No.
  const r4 = empty();
  r4[3] = `PR No.:  ${data.prNo}`;
  rows.push(r4);

  // Row 5 (index 4): Responsibility Center Code
  const r5 = empty();
  r5[3] = `Responsibility Center Code: ${data.rcCode}`;
  rows.push(r5);

  // Row 6 (index 5): Column headers
  const r6 = empty();
  r6[0] = "Stock/ Prop no.";
  r6[1] = "Unit";
  r6[2] = "Item Description";
  r6[6] = "Quantity";
  r6[7] = "Unit Cost";
  r6[8] = "Total cost";
  rows.push(r6);

  // Data rows (index 6 … 6+n-1)
  const itemStartIdx = 6;
  for (const item of items) {
    const r = empty();
    r[0] = item.stock_prop_no;
    r[1] = item.unit;
    r[2] = item.description;
    r[6] = item.quantity;
    r[7] = item.unit_cost;
    r[8] = item.quantity * item.unit_cost;
    rows.push(r);
  }

  // "Nothing follows" row
  const nfRow = empty();
  nfRow[2] = "********** Nothing Follows **********";
  rows.push(nfRow);

  // Blank gap row
  rows.push(empty());

  // Grand Total row
  const totalRow = empty();
  const grandTotal = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
  totalRow[6] = "GRAND TOTAL";
  totalRow[8] = grandTotal;
  rows.push(totalRow);

  // Purpose rows
  rows.push(empty()); // gap
  const purposeRow = empty();
  purposeRow[0] = "Purpose:";
  purposeRow[1] = data.purpose;
  rows.push(purposeRow);
  rows.push(empty()); // space for long purpose

  // Gap rows before signatures
  rows.push(empty());
  rows.push(empty());

  // Signature rows
  const sigLabel = empty();
  sigLabel[1] = "Requested By:";
  sigLabel[6] = "Approved By:";
  rows.push(sigLabel);

  const sigLine = empty();
  sigLine[0] = "Signature:";
  rows.push(sigLine);

  const nameLine = empty();
  nameLine[0] = "Printed Name:";
  nameLine[2] = data.requestedBy;
  nameLine[6] = data.approvedBy;
  rows.push(nameLine);

  const desigLine = empty();
  desigLine[0] = "Designation";
  desigLine[6] = "University President";
  rows.push(desigLine);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 14 }, // A Stock/Prop no
    { wch: 8 },  // B Unit
    { wch: 35 }, // C Item Description
    { wch: 6 },  // D
    { wch: 6 },  // E
    { wch: 6 },  // F
    { wch: 10 }, // G Quantity
    { wch: 14 }, // H Unit Cost
    { wch: 14 }, // I Total cost
  ];

  // Merges
  const M = (sr: number, sc: number, er: number, ec: number): XLSX.Range =>
    ({ s: { r: sr, c: sc }, e: { r: er, c: ec } });

  const nItems = items.length;
  const nfIdx = itemStartIdx + nItems;       // "nothing follows" row index
  const totalIdx = nfIdx + 2;                // grand total row index
  const purposeIdx = totalIdx + 2;           // purpose row index
  const sigLabelIdx = purposeIdx + 4;        // "Requested By" row index

  ws["!merges"] = [
    // Header merges
    M(1, 0, 1, 5),  // Entity name: A2:F2
    M(1, 6, 1, 8),  // Fund cluster: G2:I2 — wait, template uses H-I (7-8)
    M(2, 0, 2, 2),  // Office: A3:C3
    M(2, 4, 2, 6),  // blank middle: E3:G3
    M(2, 7, 2, 8),  // Date: H3:I3
    M(3, 0, 3, 2),  // blank: A4:C4
    M(3, 3, 3, 6),  // PR No: D4:G4
    M(3, 7, 3, 8),  // blank: H4:I4
    M(4, 3, 4, 6),  // RC Code: D5:G5
    // Column header merges
    M(5, 2, 5, 5),  // Item Description header: C6:F6
    // Item row merges (description cols C-F)
    ...Array.from({ length: nItems }, (_, i) => M(itemStartIdx + i, 2, itemStartIdx + i, 5)),
    // "Nothing follows" merge
    M(nfIdx, 2, nfIdx, 5),
    // Grand total
    M(totalIdx, 2, totalIdx, 5),
    M(totalIdx, 6, totalIdx, 7),
    // Purpose
    M(purposeIdx, 1, purposeIdx, 7),
    M(purposeIdx + 1, 1, purposeIdx + 1, 7),
    // Signatures
    M(sigLabelIdx, 6, sigLabelIdx, 8),
    M(sigLabelIdx + 1, 2, sigLabelIdx + 1, 4),
    M(sigLabelIdx + 1, 6, sigLabelIdx + 1, 8),
    M(sigLabelIdx + 2, 2, sigLabelIdx + 2, 4),
    M(sigLabelIdx + 2, 6, sigLabelIdx + 2, 8),
    M(sigLabelIdx + 3, 6, sigLabelIdx + 3, 8),
  ];

  // Total cost per item is a live formula (Quantity * Unit Cost, columns
  // G*H) instead of a pre-computed number -- opening the file shows
  // exactly how each line total was derived, and editing a quantity or
  // cost recalculates it. Grand Total in turn sums that column instead of
  // being independently recomputed.
  for (let i = 0; i < items.length; i++) {
    const row = itemStartIdx + i;
    const addr = XLSX.utils.encode_cell({ r: row, c: 8 });
    const excelRow = row + 1;
    ws[addr] = formulaCell(`G${excelRow}*H${excelRow}`, items[i].quantity * items[i].unit_cost);
  }
  const totalCellAddr = XLSX.utils.encode_cell({ r: totalIdx, c: 8 });
  if (items.length) {
    const firstRow = itemStartIdx + 1;
    const lastRow = itemStartIdx + items.length;
    ws[totalCellAddr] = formulaCell(`SUM(I${firstRow}:I${lastRow})`, grandTotal);
  } else {
    ws[totalCellAddr] = cell(grandTotal, "n");
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PR");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
