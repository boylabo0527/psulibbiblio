import * as XLSX from "xlsx";

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return Number(v).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  }
  return String(v).trim();
}

/** Parse a spreadsheet file (xls/xlsx/csv) in the browser and return raw rows. */
export function parseSheetRows(filename: string, buf: ArrayBuffer): Record<string, string>[] {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  let wb: XLSX.WorkBook;
  if (ext === "csv") {
    wb = XLSX.read(new TextDecoder().decode(buf), { type: "string" });
  } else {
    wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  return rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cellToString(v)])),
  );
}

export function isSpreadsheet(filename: string): boolean {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  return ext === "xls" || ext === "xlsx" || ext === "csv";
}
