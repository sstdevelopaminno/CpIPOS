import { describe, it, expect } from "vitest";
import { renderOfficeDocumentHtml } from "../../src/lib/printing/office-document-html";

function example(paper: "A4" | "A5") {
  return {
    paper, kind: "receipt" as const,
    number: "POS-001", issuedAt: "2026-11-18T12:00:00+07:00",
    seller: { name: "<script>alert(1)</script> ร้านอาหาร", address: "กรุงเทพฯ" },
    buyer: { name: "ผู้ซื้อ" },
    items: [{ name: "กาแฟ <b>เย็น</b>", quantity: 2, unitPrice: 55, total: 110, note: "" }],
    discount: 10, tax: 0, total: 100,
    paymentMethod: "cash", currency: "THB" as const
  };
}

describe("POS/Finance shared A4/A5 copy renderer", () => {
  it("renders both true paper sizes, original amounts, and no invented tax ID", () => {
    for (const paper of ["A4", "A5"] as const) {
      const html = renderOfficeDocumentHtml(example(paper));
      expect(html).toContain(`@page { size: ${paper} portrait;`);
      expect(html).toContain("POS-001");
      expect(html).toContain("110.00");
      expect(html).toContain("100.00");
      expect(html).not.toContain("เลขประจำตัวผู้เสียภาษี:");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("กาแฟ &lt;b&gt;เย็น&lt;/b&gt;");
      expect(html).toContain("ไม่ใช่การบันทึกรายการรับเงินหรือออกใบกำกับภาษีใหม่");
    }
  });
  it("never labels a receipt copy as a VAT tax invoice", () => {
    const html = renderOfficeDocumentHtml(example("A5"));
    expect(html).toContain("ใบเสร็จรับเงิน");
    expect(html).not.toContain("TAX INVOICE");
  });
});
