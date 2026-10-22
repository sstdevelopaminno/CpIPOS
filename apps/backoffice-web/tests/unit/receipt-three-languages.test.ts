import { describe, expect, it } from "vitest";
import { renderReceiptHtml } from "@/lib/printing/receipt-html-template";
const sample = { paperWidthMm: 58 as const, storeName: "Test", branchName: "Main", sellerName: "Staff", orderNo: "123", paidAtIso: "2026-10-14T04:00:00Z", items: [{ name: "Product", quantity: 1, unitPrice: 100, lineTotal: 100 }], discountAmount: 0, totalAmount: 100, paymentMethod: "cash", modeLabel: "หน้าขาย" };
describe("receipt language and currency", () => {
  it("prints Thai", () => { const h = renderReceiptHtml({ ...sample, languageCode: "th" }); expect(h).toContain("<span>ยอดสุทธิ</span>"); expect(h).toContain("<strong>เงินสด</strong>"); });
  it("prints English", () => { const h = renderReceiptHtml({ ...sample, languageCode: "en" }); expect(h).toContain("<span>Net total</span>"); expect(h).toContain("<strong>Cash</strong>"); });
  it("prints Lao in kip", () => { const h = renderReceiptHtml({ ...sample, languageCode: "lo", currencyCode: "LAK" }); expect(h).toContain("<span>ຍອດສຸດທິ</span>"); expect(h).toContain("<strong>ເງິນສົດ</strong>"); expect(h).toContain("₭100"); expect(h).not.toContain("₭100.00"); });
});
