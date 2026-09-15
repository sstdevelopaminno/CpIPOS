import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const frontCash = source("../../src/components/pos/pos-general-sale-front-cash-panel.tsx");
const generalSale = source("../../src/components/pos/pos-general-sale-mode-controller.tsx");
const paymentObserver = source("../../src/components/pos/pos-customer-display-v2-payment-observer.tsx");
const previewPage = source("../../src/app/preview/pos/page.tsx");

describe("SD front cash panel", () => {
  it("hides only the visible right cart list while preserving the existing payment panel and cart DOM bridge", () => {
    expect(frontCash).toContain('.posui-cart-col .posui-cart-panel__header { display: none !important; }');
    expect(frontCash).toContain('.posui-cart-col .posui-cart-items');
    expect(frontCash).toContain('.posui-cart-col .posui-cart-empty');
    expect(frontCash).toContain('PAYMENT_PANEL_QUERY = ".posui-cart-col .posui-payment-panel"');
    expect(generalSale).toContain('document.querySelectorAll<HTMLElement>(".posui-cart-col .posui-cart-item")');
    expect(generalSale).toContain('target?.click()');
  });

  it("keeps SKU and category columns separated for long scanner codes", () => {
    expect(frontCash).toContain('.cpipos-sd-table__sku');
    expect(frontCash).toContain('width: 190px !important');
    expect(frontCash).toContain('padding-right: 22px !important');
    expect(frontCash).toContain('.cpipos-sd-table__category');
    expect(frontCash).toContain('padding-left: 18px !important');
    expect(frontCash).toContain('text-overflow: ellipsis');
  });

  it("keeps only the SD keypad on the front sales surface without duplicating payment summary or payment engine", () => {
    expect(frontCash).toContain('["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00", "."]');
    expect(frontCash).toContain('cpipos_general_sale_cash_draft_v1');
    expect(frontCash).toContain('CASH_MODAL_QUERY = ".posui-payment-modal--cash"');
    expect(frontCash).toContain('.posui-cash-keypad__key');
    expect(frontCash).toContain('keyButton.click()');
    expect(frontCash).not.toContain('cpipos-sd-front-cash__summary');
    expect(frontCash).not.toContain('[500, 1000, 1500]');
    expect(frontCash).not.toContain('ยอดที่ต้องชำระ');
    expect(frontCash).not.toContain('เงินทอน');
    expect(frontCash).not.toContain('/api/pos/payments');
    expect(frontCash).not.toContain('fetch(');
  });

  it("keeps transfer behavior untouched and lets Customer Display V2 observe the existing cash/transfer/receipt surfaces", () => {
    expect(frontCash).not.toContain('bank_transfer');
    expect(frontCash).not.toContain('transfer-qr-only');
    expect(paymentObserver).toContain('.posui-payment-modal--cash');
    expect(paymentObserver).toContain('.posui-payment-modal--transfer-qr-only');
    expect(paymentObserver).toContain('.posui-payment-modal--receipt-final');
    expect(paymentObserver).toContain('CUSTOMER_DISPLAY_V2_PAYMENT_EVENT');
  });

  it("mounts alongside the existing Customer Display publisher and payment observer", () => {
    expect(previewPage).toContain('<PosCustomerDisplayV2Publisher />');
    expect(previewPage).toContain('<PosCustomerDisplayV2PaymentObserver />');
    expect(previewPage).toContain('<PosGeneralSaleModeController />');
    expect(previewPage).toContain('<PosGeneralSaleFrontCashPanel />');
  });
});
