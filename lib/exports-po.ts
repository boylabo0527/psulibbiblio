import * as XLSX from "xlsx";
import type { PRItem } from "./exports-pr";

export type POData = {
  transNo: string;
  philgepsRefNo: string;
  supplier: string;
  address: string;
  tin: string;
  poNo: string;
  date: string;
  modeOfProcurement: string;
  placeOfDelivery: string;
  deliveryTerm: string;
  dateOfDelivery: string;
  paymentTerm: string;
  fundCluster: string;
  orsBursNo: string;
  dateOfOrsBurs: string;
  approvedByName: string;
  approvedByTitle: string;
  notes: string;
  items: PRItem[];
};

const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function threeDigitsToWords(n: number): string[] {
  const words: string[] = [];
  if (n >= 100) {
    words.push(ONES[Math.floor(n / 100)], "HUNDRED");
    n %= 100;
  }
  if (n >= 20) {
    words.push(TENS[Math.floor(n / 10)]);
    n %= 10;
    if (n > 0) words.push(ONES[n]);
  } else if (n > 0) {
    words.push(ONES[n]);
  }
  return words;
}

function integerToWords(n: number): string {
  if (n === 0) return "ZERO";
  const groups = ["", "THOUSAND", "MILLION", "BILLION"];
  const parts: string[][] = [];
  let groupIdx = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      const chunkWords = threeDigitsToWords(chunk);
      if (groups[groupIdx]) chunkWords.push(groups[groupIdx]);
      parts.unshift(chunkWords);
    }
    n = Math.floor(n / 1000);
    groupIdx++;
  }
  return parts.flat().join(" ");
}

/** e.g. 394800 -> "THREE HUNDRED NINETY FOUR THOUSAND EIGHT HUNDRED PESOS
 *  AND 00/100 ONLY" -- matches the phrasing on PSU's printed PO form. */
export function amountToPesoWords(amount: number): string {
  const pesos = Math.floor(Math.max(0, amount));
  const centavos = Math.round((Math.max(0, amount) - pesos) * 100);
  return `${integerToWords(pesos)} ${pesos === 1 ? "PESO" : "PESOS"} AND ${String(centavos).padStart(2, "0")}/100 ONLY`;
}

function cell(v: unknown, t?: "n" | "s"): XLSX.CellObject {
  return { v, t: t ?? (typeof v === "number" ? "n" : "s") } as XLSX.CellObject;
}

/** A numeric cell backed by a live formula (`f`, no leading "=") instead of
 *  a bare value -- `v` is still the current computed number, kept as the
 *  cached display value for viewers that don't recalculate on open. */
function formulaCell(formula: string, v: number): XLSX.CellObject {
  return { t: "n", v, f: formula } as XLSX.CellObject;
}

export function generatePurchaseOrderXlsx(data: POData): Buffer {
  const { items } = data;
  const COLS = 9;
  const empty = (): unknown[] => Array(COLS).fill("");
  const rows: unknown[][] = [];

  rows.push(empty()); // 0: blank/logo row
  const r1 = empty(); r1[0] = "PURCHASE ORDER"; rows.push(r1); // 1
  const r2 = empty(); r2[0] = "PALAWAN STATE UNIVERSITY"; rows.push(r2); // 2
  const r3 = empty(); r3[0] = "Tiniguban, Puerto Princesa City"; rows.push(r3); // 3
  rows.push(empty()); // 4: gap

  const r5 = empty(); r5[0] = `Trans No.: ${data.transNo}`; r5[6] = `PhilGEPS Ref No.: ${data.philgepsRefNo}`; rows.push(r5); // 5
  rows.push(empty()); // 6: gap

  const r7 = empty(); r7[0] = `Supplier: ${data.supplier}`; r7[6] = `P.O. No.: ${data.poNo}`; rows.push(r7); // 7
  const r8 = empty(); r8[0] = `Address: ${data.address}`; r8[6] = `Date: ${data.date}`; rows.push(r8); // 8
  const r9 = empty(); r9[0] = `TIN: ${data.tin}`; r9[6] = `Mode of Procurement: ${data.modeOfProcurement}`; rows.push(r9); // 9
  rows.push(empty()); // 10: gap

  const r11 = empty(); r11[0] = "Gentlemen:"; rows.push(r11); // 11
  const r12 = empty(); r12[0] = "Please furnish this Office the following articles subject to the terms and conditions contained herein:"; rows.push(r12); // 12
  rows.push(empty()); // 13: gap

  const r14 = empty(); r14[0] = `Place of Delivery: ${data.placeOfDelivery}`; r14[5] = `Delivery Term: ${data.deliveryTerm}`; rows.push(r14); // 14
  const r15 = empty(); r15[0] = `Date of Delivery: ${data.dateOfDelivery}`; r15[5] = `Payment Term: ${data.paymentTerm}`; rows.push(r15); // 15
  rows.push(empty()); // 16: gap

  const headerIdx = 17;
  const rh = empty();
  rh[0] = "Stock/ Prop no."; rh[1] = "Unit"; rh[2] = "Description";
  rh[6] = "Quantity"; rh[7] = "Unit Cost"; rh[8] = "Amount";
  rows.push(rh);

  const itemStartIdx = headerIdx + 1;
  for (const item of items) {
    const r = empty();
    r[0] = item.stock_prop_no; r[1] = item.unit; r[2] = item.description;
    r[6] = item.quantity; r[7] = item.unit_cost; r[8] = item.quantity * item.unit_cost;
    rows.push(r);
  }

  let notesIdx = -1;
  if (data.notes.trim()) {
    notesIdx = rows.length;
    const rNotes = empty();
    rNotes[2] = data.notes;
    rows.push(rNotes);
  }

  const nfIdx = rows.length;
  const rNf = empty(); rNf[2] = "********** Nothing Follows **********"; rows.push(rNf);

  rows.push(empty()); // gap

  const grandTotal = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
  const wordsLabelIdx = rows.length;
  const rWordsLabel = empty(); rWordsLabel[0] = "(Total amount in words)"; rows.push(rWordsLabel);
  const wordsIdx = rows.length;
  const rWords = empty();
  rWords[0] = amountToPesoWords(grandTotal);
  rWords[6] = "GRAND TOTAL";
  rows.push(rWords);

  rows.push(empty()); // gap
  const penaltyIdx = rows.length;
  const rPenalty = empty();
  rPenalty[0] = "In case of failure to make the full delivery within the time specified above, a penalty of one-tenth (1/10) of one percent "
    + "for every day of delay shall be imposed on the undelivered item/s.";
  rows.push(rPenalty);
  rows.push(empty()); // gap

  const conformeIdx = rows.length;
  const rConforme = empty(); rConforme[0] = "Conforme:"; rConforme[6] = "Very truly yours,"; rows.push(rConforme);
  rows.push(empty());
  rows.push(empty());
  const signerNameIdx = rows.length;
  const rSignerName = empty(); rSignerName[2] = data.supplier; rSignerName[6] = data.approvedByName; rows.push(rSignerName);
  const signerRoleIdx = rows.length;
  const rSignerRole = empty(); rSignerRole[2] = "Signature over Printed Name of Supplier"; rSignerRole[6] = data.approvedByTitle; rows.push(rSignerRole);
  const dateLineIdx = rows.length;
  const rDateLine = empty(); rDateLine[2] = "Date"; rows.push(rDateLine);
  rows.push(empty());

  const fundIdx = rows.length;
  const rFund = empty(); rFund[0] = `Fund Cluster: ${data.fundCluster}`; rFund[6] = `ORS/BURS No.: ${data.orsBursNo}`; rows.push(rFund);
  const availIdx = rows.length;
  const rAvail = empty(); rAvail[0] = "Funds Available: "; rAvail[6] = `Date of the ORS/BURS: ${data.dateOfOrsBurs}`; rows.push(rAvail);
  const amtIdx = rows.length;
  const rAmt = empty(); rAmt[6] = `Amount: ${grandTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`; rows.push(rAmt);
  const accIdx = rows.length;
  const rAcc = empty(); rAcc[1] = "Signature over Printed Name of Chief Accountant/Head of Accounting Division/Unit"; rows.push(rAcc);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = [
    { wch: 14 }, { wch: 8 }, { wch: 30 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
  ];

  const M = (sr: number, sc: number, er: number, ec: number): XLSX.Range => ({ s: { r: sr, c: sc }, e: { r: er, c: ec } });
  const nItems = items.length;

  ws["!merges"] = [
    M(1, 0, 1, 8), M(2, 0, 2, 8), M(3, 0, 3, 8),
    M(5, 0, 5, 5), M(5, 6, 5, 8),
    M(7, 0, 7, 5), M(7, 6, 7, 8),
    M(8, 0, 8, 5), M(8, 6, 8, 8),
    M(9, 0, 9, 5), M(9, 6, 9, 8),
    M(11, 0, 11, 8), M(12, 0, 12, 8),
    M(14, 0, 14, 4), M(14, 5, 14, 8),
    M(15, 0, 15, 4), M(15, 5, 15, 8),
    M(headerIdx, 2, headerIdx, 5),
    ...Array.from({ length: nItems }, (_, i) => M(itemStartIdx + i, 2, itemStartIdx + i, 5)),
    ...(notesIdx >= 0 ? [M(notesIdx, 2, notesIdx, 5)] : []),
    M(nfIdx, 2, nfIdx, 5),
    M(wordsLabelIdx, 0, wordsLabelIdx, 5),
    M(wordsIdx, 0, wordsIdx, 5), M(wordsIdx, 6, wordsIdx, 7),
    M(penaltyIdx, 0, penaltyIdx, 8),
    M(conformeIdx, 0, conformeIdx, 3), M(conformeIdx, 6, conformeIdx, 8),
    M(signerNameIdx, 2, signerNameIdx, 4), M(signerNameIdx, 6, signerNameIdx, 8),
    M(signerRoleIdx, 2, signerRoleIdx, 4), M(signerRoleIdx, 6, signerRoleIdx, 8),
    M(dateLineIdx, 2, dateLineIdx, 4),
    M(fundIdx, 0, fundIdx, 5), M(fundIdx, 6, fundIdx, 8),
    M(availIdx, 0, availIdx, 5), M(availIdx, 6, availIdx, 8),
    M(amtIdx, 6, amtIdx, 8),
    M(accIdx, 1, accIdx, 8),
  ];

  // Amount per item is a live formula (Quantity * Unit Cost, columns G*H)
  // instead of a pre-computed number, and the Grand Total cell sums that
  // column instead of being independently recomputed -- same treatment as
  // the Purchase Request export (see lib/exports-pr.ts).
  for (let i = 0; i < items.length; i++) {
    const row = itemStartIdx + i;
    const addr = XLSX.utils.encode_cell({ r: row, c: 8 });
    const excelRow = row + 1;
    ws[addr] = formulaCell(`G${excelRow}*H${excelRow}`, items[i].quantity * items[i].unit_cost);
  }
  const wordsAmountCellAddr = XLSX.utils.encode_cell({ r: wordsIdx, c: 8 });
  if (items.length) {
    const firstRow = itemStartIdx + 1;
    const lastRow = itemStartIdx + items.length;
    ws[wordsAmountCellAddr] = formulaCell(`SUM(I${firstRow}:I${lastRow})`, grandTotal);
  } else {
    ws[wordsAmountCellAddr] = cell(grandTotal, "n");
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PO");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
