import { describe, expect, it } from "vitest";
import { buildExcelCsvText, buildExcelHtmlBytes, buildExcelHtmlText } from "../../src/lib/excel-csv";

describe("Excel CSV export", () => {
  it("keeps CSV text correctly escaped for fallback export paths", () => {
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

  it("builds UTF-8 Excel HTML so Thai text survives double-click open in Excel", () => {
    const html = buildExcelHtmlText([
      ["พนักงาน", "ยอดสุทธิ"],
      ["นักพัฒนาระบบ", "฿16,776.62"],
      ["=SUM(A1:A2)", "มี \"quote\""]
    ]);

    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<td");
    expect(html).toContain("พนักงาน");
    expect(html).toContain("นักพัฒนาระบบ");
    expect(html).toContain("'=SUM(A1:A2)");
    expect(html).toContain("มี &quot;quote&quot;");
  });

  it("prefixes Excel HTML bytes with UTF-8 BOM", () => {
    const bytes = buildExcelHtmlBytes([["สินค้า"], ["ก๋วยเตี๋ยว"]]);
    const decoded = new TextDecoder("utf-8").decode(bytes);

    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(decoded).toContain("ก๋วยเตี๋ยว");
  });
});
