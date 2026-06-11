function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return Number(v).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  }
  return String(v).trim();
}

const SPREADSHEET_EXTS = new Set(["xls", "xlsx", "csv"]);
const SPREADSHEET_MIME = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);

export function isSpreadsheet(file: File): boolean {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return SPREADSHEET_EXTS.has(ext) || SPREADSHEET_MIME.has(file.type);
}

/** Parse a spreadsheet file in the browser using a dynamic xlsx import. */
export async function parseSheetRows(file: File): Promise<Record<string, string>[]> {
  // Dynamic import so Next.js doesn't try to resolve xlsx during SSR.
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();

  let wb: import("xlsx").WorkBook;
  if (ext === "csv" || file.type === "text/csv" || file.type === "application/csv") {
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
