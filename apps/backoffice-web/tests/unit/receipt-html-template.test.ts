import { describe, expect, it } from "vitest";
import { normalizeReceiptModeLabel, renderReceiptHtml } from "@/lib/printing/receipt-html-template";

describe("receipt Thai mode labels", () => {
  it("repairs the legacy corrupted sales-mode label", () => {
    expect(normalizeReceiptModeLabel("\u0e40\u0e18\u0e0b\u0e40\u0e18\u0099\u0e40\u0e19\u0089\u0e40\u0e18\u0e12\u0e40\u0e18\u0082\u0e40\u0e18\u0e12\u0e40\u0e18\u0e02")).toBe("หน้าขาย");
  });

  it("repairs the legacy corrupted receipt-history label", () => {
    expect(normalizeReceiptModeLabel("\u0e40\u0e19\u0083\u0e40\u0e18\u009a\u0e40\u0e19\u20ac\u0e40\u0e18\u0e0a\u0e40\u0e18\u0e03\u0e40\u0e19\u0087\u0e40\u0e18\u0088\u0e40\u0e18\u0e02\u0e40\u0e19\u0089\u0e40\u0e18\u0e0d\u0e40\u0e18\u0099\u0e40\u0e18\u0e0b\u0e40\u0e18\u0e05\u0e40\u0e18\u0e11\u0e40\u0e18\u0087")).toBe("ใบเสร็จย้อนหลัง");
  });

  it("renders the corrected Thai value on the Mode row", () => {
    const html = renderReceiptHtml({
      paperWidthMm: 80,
      storeName: "ร้านทดสอบ",
      branchName: "สาขาทดสอบ",
      sellerName: "พนักงาน",
      orderNo: "TEST-001",
      modeLabel: "\u0e40\u0e18\u0e0b\u0e40\u0e18\u0099\u0e40\u0e19\u0089\u0e40\u0e18\u0e12\u0e40\u0e18\u0082\u0e40\u0e18\u0e12\u0e40\u0e18\u0e02",
      paidAtIso: "2026-08-17T04:00:00.000Z",
      items: [{ name: "สินค้า", quantity: 1, unitPrice: 10, lineTotal: 10 }],
      discountAmount: 0,
      totalAmount: 10,
      paymentMethod: "cash",
      cashReceived: 10,
      changeAmount: 0
    });

    expect(html).toContain("<span>โหมด</span><span>หน้าขาย</span>");
    expect(html).not.toContain("\u0e40\u0e18\u0e0b\u0e40\u0e18\u0099\u0e40\u0e19\u0089\u0e40\u0e18\u0e12\u0e40\u0e18\u0082\u0e40\u0e18\u0e12\u0e40\u0e18\u0e02");
  });
});
