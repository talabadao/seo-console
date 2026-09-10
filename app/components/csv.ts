/** Quote/escape a CSV field and neutralise leading spreadsheet-formula characters. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Trigger a CSV download. Prepends a UTF-8 BOM (U+FEFF) + CRLF so Excel on
 * Windows reads it as UTF-8 instead of the system codepage (which mangles
 * Korean / Japanese / Chinese / Cyrillic / accented text).
 */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
