import { describe, expect, it, vi } from "vitest";
import type { ReceiptTemplate } from "@pos/shared-types";

vi.mock("@/lib/printing/print-service", () => ({
  renderReceiptTemplate: () => "LEGACY THAI"
}));

import { renderLocalizedReceiptText } from "@/lib/printing/receipt-text-localized";

const sample = {
  business_name: "Shop",
  branch_name: "Main",
  order_no: "BILL-09",
  paid_at_iso: "2026-10-14T10:00:00Z",
  cashier_name: "Cashier",
  items: [{ name: "Coffee", qty: 2, unit_price: 1000, line_total: 2000 }],
  subtotal: 2000,
  discount_amount: 0,
  tax_amount: 0,
  total_amount: 2000,
  payment_method: "cash",
  cash_received: 2000,
  change_amount: 0,
  mode_label: "หน้าขาย"
} as ReceiptTemplate;

describe("fallback thermal receipt localization", () => {
  it("keeps legacy Thai/THB formatter unchanged", () => {
    expect(renderLocalizedReceiptText(sample, 58, "th", "THB")).toBe("LEGACY THAI");
  });
  it("renders Lao in kip with no decimals", () => {
    const receipt = renderLocalizedReceiptText(sample, 58, "lo", "LAK");
    expect(receipt).toContain("ຍອດສຸດທິ: ₭2,000");
    expect(receipt).toContain("ເງິນສົດ");
    expect(receipt).not.toContain("2,000.00");
    expect(receipt).not.toContain("บาท");
  });
  it("renders English in baht independent of locale currency", () => {
    const receipt = renderLocalizedReceiptText(sample, 80, "en", "THB");
    expect(receipt).toContain("Net total: ฿2,000.00");
    expect(receipt).toContain("Cash");
  });
});
