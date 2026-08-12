import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSanitizedOrderSubmitPayload } from "@/components/pos/services/pos-sales-service-module";
import { renderPaymentNoticeHtml } from "@/lib/printing/payment-notice-html-template";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function sampleNotice(paperWidthMm: 58 | 80) {
  return renderPaymentNoticeHtml({
    paperWidthMm,
    storeName: "SST Foods",
    branchName: "Table Branch",
    sellerName: "Cashier One",
    tableLabel: "A1",
    orderNo: "POS-2001",
    createdAtIso: "2026-08-12T10:00:00.000Z",
    items: [{ name: "Pad Thai", quantity: 2, unitPrice: 80, lineTotal: 160 }],
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 160,
    accountLabel: "Bank / Shop / 123",
    promptPayLabel: "0812345678",
    qrDataUri: "data:image/png;base64,aGVsbG8="
  });
}

describe("POS payment stability hotfix", () => {
  it("preserves modifier notes through sanitized order submit payload", () => {
    const payload = buildSanitizedOrderSubmitPayload({
      shift_id: "shift-1",
      order_type: "dine_in",
      channel: "storefront",
      table_id: "table-1",
      app_total_amount: 100,
      items: [{ product_id: " product-1 ", quantity: 1, unit_price: 100, notes: "เลือกวัตถุดิบ: หมู x2" }]
    } as never);

    expect(payload.items[0]).toEqual({ product_id: "product-1", quantity: 1, unit_price: 100, notes: "เลือกวัตถุดิบ: หมู x2" });
  });

  it("normalizes blank modifier notes to null", () => {
    const payload = buildSanitizedOrderSubmitPayload({
      shift_id: "shift-1",
      order_type: "takeaway",
      channel: "walk_home",
      app_total_amount: 100,
      items: [{ product_id: "product-1", quantity: 1, unit_price: 100, notes: "   " }]
    } as never);

    expect(payload.items[0]?.notes).toBeNull();
  });

  it("does not clear cart during prepayment order submit", () => {
    const moduleSource = source("src/components/pos/services/pos-sales-service-module.ts");
    expect(moduleSource).not.toContain('if (sanitizedPayload.order_type !== "takeaway") {\r\n      setCart([]);');
    expect(moduleSource).not.toContain('if (sanitizedPayload.order_type !== "takeaway") {\n      setCart([]);');
  });

  it("payment review no longer renders ingredient deduction controls or fetches recipe products", () => {
    const modalSource = source("src/components/pos/pos-payment-modals.tsx");
    const salesSource = source("src/components/pos/pos-sales-module.tsx");
    expect(modalSource).not.toContain("posui-payment-modal__item-ingredient-btn");
    expect(modalSource).not.toContain("onDeductIngredientForItem");
    expect(salesSource).not.toContain("/api/pos/recipe-products?product_ids=${query}");
  });

  it("manual drawer flow no longer uses browser prompt and requires ready state", () => {
    const salesSource = source("src/components/pos/pos-sales-module.tsx");
    const start = salesSource.indexOf("async function openCashDrawerManually");
    const end = salesSource.indexOf("useEffect", start);
    const drawerSource = salesSource.slice(start, end);
    expect(drawerSource).not.toContain("window.prompt");
    expect(drawerSource).toContain("if (!cashDrawerReady)");
    expect(salesSource).toContain("onOpenCashDrawer={cashDrawerReady ? openCashDrawerManually : undefined}");
  });

  it("cash payment enqueues server drawer side effect and client duplicate path is disabled", () => {
    const paymentsSource = source("src/app/api/pos/payments/route.ts");
    const salesSource = source("src/components/pos/pos-sales-module.tsx");
    const sideEffectStart = salesSource.indexOf("function runPostPaymentSideEffects");
    const sideEffectEnd = salesSource.indexOf("const handleTableBrowserRetryLoad", sideEffectStart);
    const sideEffectSource = salesSource.slice(sideEffectStart, sideEffectEnd);
    expect(paymentsSource).toContain("openCashDrawerController");
    expect(paymentsSource).toContain('triggerSource: "cash_payment"');
    expect(sideEffectSource).not.toContain("openCashDrawerAfterCashPayment");
  });

  it("paid receipt modal no longer exposes manual print receipt button", () => {
    const modalSource = source("src/components/pos/pos-payment-modals.tsx");
    expect(modalSource).not.toContain("text.receiptPrint");
    expect(modalSource).not.toContain("onPrintReceipt");
  });

  it("dine-in transfer can print a payment notice without confirming payment", () => {
    const modalSource = source("src/components/pos/pos-payment-modals.tsx");
    const salesSource = source("src/components/pos/pos-sales-module.tsx");
    const fnStart = salesSource.indexOf("async function printTransferPaymentNotice");
    const fnEnd = salesSource.indexOf("async function confirmTransferPayment", fnStart);
    const fnSource = salesSource.slice(fnStart, fnEnd);
    expect(modalSource).toContain("onPrintPaymentNotice");
    expect(fnSource).toContain("/api/pos/payment-notice");
    expect(fnSource).not.toContain("confirmTransferPayment");
    expect(fnSource).not.toContain("/api/pos/payments");
    expect(fnSource).not.toContain("setCart([])");
  });

  it("payment notice HTML contains QR and PAYMENT NOTICE", () => {
    const html = sampleNotice(58);
    expect(html).toContain("PAYMENT NOTICE");
    expect(html).toContain("ใบแจ้งชำระเงิน");
    expect(html).toContain("data:image/png;base64,aGVsbG8=");
  });

  it("payment notice supports native 58mm and 80mm layouts", () => {
    expect(sampleNotice(58)).toContain("@page { size: 58mm auto");
    expect(sampleNotice(80)).toContain("@page { size: 80mm auto");
  });

  it("payment notice route uses printer profile paper width", () => {
    const routedSource = source("src/lib/printing/routed-print-service.ts");
    const start = routedSource.indexOf("export async function queueRoutedPaymentNotice");
    const end = routedSource.indexOf("export async function queueRoutedKitchenFallback", start);
    const noticeSource = routedSource.slice(start, end);
    expect(noticeSource).toContain("paperWidthMm: route.printer.paper_width_mm");
    expect(noticeSource).not.toContain("paperWidthMm: 58");
  });
});
