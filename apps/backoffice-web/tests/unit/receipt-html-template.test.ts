import { describe, expect, it } from "vitest";
import { normalizeReceiptModeLabel, renderReceiptHtml } from "@/lib/printing/receipt-html-template";

describe("receipt Thai mode labels", () => {
  it("repairs the legacy corrupted sales-mode label", () => {
    expect(normalizeReceiptModeLabel("เธซเธเนเธฒเธเธฒเธข")).toBe("หน้าขาย");
  });

  it("repairs the legacy corrupted receipt-history label", () => {
    expect(normalizeReceiptModeLabel("เนเธเน€เธชเธฃเนเธเธขเนเธญเธเธซเธฅเธฑเธ")).toBe("ใบเสร็จย้อนหลัง");
  });

  it("renders the corrected Thai value on the Mode row", () => {
    const html = renderReceiptHtml({
      paperWidthMm: 80,
      storeName: "ร้านทดสอบ",
      branchName: "สาขาทดสอบ",
      sellerName: "พนักงาน",
      orderNo: "TEST-001",
      modeLabel: "เธซเธเนเธฒเธเธฒเธข",
      paidAtIso: "2026-08-17T04:00:00.000Z",
      items: [{ name: "สินค้า", quantity: 1, unitPrice: 10, lineTotal: 10 }],
      discountAmount: 0,
      totalAmount: 10,
      paymentMethod: "cash",
      cashReceived: 10,
      changeAmount: 0
    });

    expect(html).toContain("<span>โหมด</span><span>หน้าขาย</span>");
    expect(html).not.toContain("เธซเธเนเธฒเธเธฒเธข");
  });
});
