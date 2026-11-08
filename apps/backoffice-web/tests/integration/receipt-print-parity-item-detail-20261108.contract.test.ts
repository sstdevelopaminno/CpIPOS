import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { composePosItemNotes } from "../../src/lib/pos-item-notes";
import { renderReceiptHtml } from "../../src/lib/printing/receipt-html-template";
import { renderPaymentNoticeHtml } from "../../src/lib/printing/payment-notice-html-template";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const itemNote = composePosItemNotes("มาม่า instant", "ไม่ผัก")!;

describe("automatic receipt print parity: Web, Windows bridge and Android agent", () => {
  it.each([58, 80] as const)("renders clean compact %imm sale receipts with the selected ingredient and item detail", (paperWidthMm) => {
    const html = renderReceiptHtml({
      paperWidthMm, languageCode: "th",
      storeName: "ข้าวมันไก่สามเซียน", branchName: "7-11 ตลาดเดียว",
      storePhone: "0824011412", sellerName: "พี่ปุ๊ก",
      orderNo: "DIN-261108-001", modeLabel: "นั่งโต๊ะ",
      paidAtIso: "2026-11-08T06:40:17.000Z",
      items: [{ name: "ก๋วยเตี๋ยวน้ำตก Namtok", quantity: 1, unitPrice: 50, lineTotal: 50, note: itemNote }],
      discountAmount: 0, totalAmount: 50, paymentMethod: "cash",
      cashReceived: 100, changeAmount: 50
    });
    expect(html).toContain("@page { size: " + paperWidthMm + "mm auto; margin: 0; }");
    expect(html).toContain("ข้าวมันไก่สามเซียน");
    expect(html).toContain("+ มาม่า instant");
    expect(html).toContain("รายละเอียด:");
    expect(html).toContain("ไม่ผัก");
    expect(html).toContain("฿50.00");
    expect(html).toContain("฿100.00");
    expect(html).not.toContain("[[CPIPOS_ITEM_DETAIL]]");
    expect(html).not.toContain("%E0%B9%");
  });

  it("decodes item detail in QR payment notices and never prints an internal marker", () => {
    const html = renderPaymentNoticeHtml({
      paperWidthMm: 58, storeName: "ร้านทดสอบ", branchName: "สาขาหลัก",
      sellerName: "พนักงาน", orderNo: "DIN-001",
      createdAtIso: "2026-11-08T06:40:17Z",
      items: [{name: "ก๋วยเตี๋ยว", quantity: 1, unitPrice: 50, lineTotal: 50, note: itemNote}],
      discountAmount: 0, totalAmount: 50,
      qrDataUri: "data:image/png;base64,ZHVtbXk="
    });
    expect(html).toContain("มาม่า instant");
    expect(html).toContain("รายละเอียด: ไม่ผัก");
    expect(html).not.toContain("[[CPIPOS_ITEM_DETAIL]]");
    expect(html).toContain("ยังไม่ใช่ใบเสร็จรับเงิน");
  });

  it("uses one canonical server-routed print job and a configured cash-drawer command after payment", () => {
    const payment = source("src/app/api/pos/payments/route.ts");
    const routes = source("src/lib/printing/routed-print-service.ts");
    const agent = source("src/components/printing/windows-native-print-agent.tsx");
    const sale = source("src/components/pos/pos-sales-module.tsx");
    expect(payment).toContain("if (!duplicatePaymentReplay)");
    expect(payment).toContain("queueRoutedSalesReceipt({");
    expect(payment).toContain("openCashDrawerController(auth, {");
    expect(payment).toContain('triggerSource: "cash_payment"');
    expect(routes).toContain("renderReceiptHtml({");
    expect(routes).toContain("storeProfile?.company_address");
    expect(routes).toContain("route.printer.paper_width_mm");
    expect(agent).toContain("markAttempted(job.id)");
    expect(agent).toContain('action: "ack"');
    expect(agent).toContain('action: "fail"');
    expect(sale).toContain('new Event("cpi-windows-print-agent-wake")');
  });

  it("never offers a second receipt-print action in the paid popup", () => {
    const modal = source("src/components/pos/pos-payment-modals.tsx");
    const sale = source("src/components/pos/pos-sales-module.tsx");
    expect(modal).toContain("parsePosItemNotes(notes)");
    expect(modal).toContain("receiptSession.items.map");
    expect(modal).not.toContain("printReceiptOnce");
    expect(modal).not.toContain("onPrintReceipt");
    expect(sale).not.toContain("onPrintReceipt={handleReceiptPrint}");
    expect(sale).toContain("cpi-windows-print-agent-result");
  });

  it("separates history reprints, payment notices and shift-close reports", () => {
    const history = source("src/components/pos-preview/pos-receipts-workspace.tsx");
    const shiftRoute = source("src/app/api/pos/shifts/[shiftId]/print/route.ts");
    expect(history).toContain("parsePosItemNotes(notes)");
    expect(history).toContain('onClick={() => void submitReprint()}');
    expect(shiftRoute).toContain("queueRoutedShiftReport");
    expect(shiftRoute).toContain("runtimeDeviceCode: scope.session.device_code");
  });
});
