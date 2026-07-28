import { describe, expect, it } from "vitest";
import { buildExcelCsvBytes, buildExcelCsvText } from "../../src/lib/excel-csv";

describe("Excel CSV export", () => {
  it("builds Excel-friendly CSV with Thai text and stable columns", () => {
    const text = buildExcelCsvText([
      ["เลขบิล", "สาขา", "ยอดรวม"],
      ["DIN-QR-1", "ถนนเพชรบุรี", "฿110.00"],
      ["=SUM(A1:A2)", "มี,comma", "มี \"quote\""]
    ]);

    expect(text).toContain("sep=,\r\n");
    expect(text).toContain("\"เลขบิล\",\"สาขา\",\"ยอดรวม\"");
    expect(text).toContain("\"DIN-QR-1\",\"ถนนเพชรบุรี\",\"฿110.00\"");
    expect(text).toContain("\"'=SUM(A1:A2)\",\"มี,comma\",\"มี \"\"quote\"\"\"");
  });

  it("encodes CSV as UTF-16LE with BOM for Windows Excel", () => {
    const bytes = buildExcelCsvBytes([
      ["พนักงาน", "ยอดสุทธิ"],
      ["นักพัฒนาระบบ", "฿16,776.62"]
    ]);
    const decoded = new TextDecoder("utf-16le").decode(bytes.slice(2));

    expect(Array.from(bytes.slice(0, 2))).toEqual([0xff, 0xfe]);
    expect(decoded).toContain("\"พนักงาน\",\"ยอดสุทธิ\"");
    expect(decoded).toContain("\"นักพัฒนาระบบ\",\"฿16,776.62\"");
  });
});
