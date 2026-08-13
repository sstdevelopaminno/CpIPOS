import { describe, expect, it } from "vitest";
import { renderPaymentNoticeHtml } from "@/lib/printing/payment-notice-html-template";

function renderNotice() {
  return renderPaymentNoticeHtml({
    paperWidthMm: 58,
    storeName: "CpIPOS QA",
    branchName: "Branch A",
    sellerName: "Cashier",
    tableLabel: "A1",
    orderNo: "POS-PRIVACY-001",
    createdAtIso: "2026-08-13T10:00:00.000Z",
    items: [{ name: "ข้าวผัด", quantity: 1, unitPrice: 80, lineTotal: 80 }],
    discountAmount: 0,
    totalAmount: 80,
    accountLabel: "SECRET_ACCOUNT_NAME_AND_NUMBER_123456",
    promptPayLabel: "SECRET_PROMPTPAY_0899999999",
    qrDataUri: "data:image/png;base64,aGVsbG8="
  });
}

describe("payment notice privacy", () => {
  it("keeps payment QR and amount while hiding account and PromptPay identifiers", () => {
    const html = renderNotice();

    expect(html).toContain("ใบแจ้งชำระเงิน");
    expect(html).toContain("สแกน QR เพื่อชำระเงิน");
    expect(html).toContain("data:image/png;base64,aGVsbG8=");
    expect(html).toContain("80.00");

    expect(html).not.toContain("SECRET_ACCOUNT_NAME_AND_NUMBER_123456");
    expect(html).not.toContain("SECRET_PROMPTPAY_0899999999");
    expect(html).not.toContain(">บัญชี<");
    expect(html).not.toContain(">PromptPay<");
  });
});
