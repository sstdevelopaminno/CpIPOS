export type CsvCellValue = string | number | null | undefined;

function escapeCsvCell(value: CsvCellValue, delimiter: string) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function buildExcelCsvText(rows: CsvCellValue[][], delimiter = ",") {
  const body = rows.map((row) => row.map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter)).join("\r\n");
  return `sep=${delimiter}\r\n${body}\r\n`;
}

export function encodeUtf16LeWithBom(text: string) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const offset = 2 + index * 2;
    bytes[offset] = code & 0xff;
    bytes[offset + 1] = code >> 8;
  }
  return bytes;
}

export function buildExcelCsvBytes(rows: CsvCellValue[][], delimiter = ",") {
  return encodeUtf16LeWithBom(buildExcelCsvText(rows, delimiter));
}

export function buildExcelCsvBlob(rows: CsvCellValue[][], delimiter = ",") {
  return new Blob([buildExcelCsvBytes(rows, delimiter)], { type: "text/csv;charset=utf-16le" });
}

export function downloadExcelCsv(filename: string, rows: CsvCellValue[][], delimiter = ",") {
  const blob = buildExcelCsvBlob(rows, delimiter);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
