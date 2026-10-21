import { describe, expect, it } from "vitest";
import {
  buildOpticalBillRecallCode,
  buildOpticalPickupBarcode,
  opticalDepositReceiptCanRecall,
  parseOpticalBillRecallCode,
  validateOpticalDeposit,
  type OpticalBillSnapshot
} from "@/lib/optical/optical-deposit-contract";
import { renderOpticalDepositReceipt80mm } from "@/lib/optical/optical-deposit-receipt-80mm";

const bill: OpticalBillSnapshot = {
  tenantId: "qa-tenant",
  branchId: "qa-branch",
  orderId: "11111111-1111-4111-8111-111111111111",
  currencyCode: "LAK",
  totalAmount: 1000,
  paidAmount: 0,
  status: "unpaid"
};
const depositBill: OpticalBillSnapshot = { ...bill, paidAmount: 500, status: "partially_paid" };

describe("isolated Optical deposit money rules", () => {
  it("accepts 500 LAK of 1000 and calculates a 500 LAK balance", () => {
    expect(validateOpticalDeposit(bill, 500)).toEqual({
      ok: true, amount: 500, remainingAmount: 500, nextStatus: "partially_paid"
    });
    expect(validateOpticalDeposit(depositBill, 500)).toEqual({
      ok: true, amount: 500, remainingAmount: 0, nextStatus: "paid"
    });
  });
  it("rejects duplicate excess deposits, terminal bills, invalid amount and float LAK", () => {
    expect(validateOpticalDeposit(depositBill, 501)).toEqual({ ok: false, code: "deposit_exceeds_balance" });
    expect(validateOpticalDeposit(depositBill, 0)).toEqual({ ok: false, code: "invalid_amount" });
    expect(validateOpticalDeposit(depositBill, 0.5)).toEqual({ ok: false, code: "invalid_amount" });
    expect(validateOpticalDeposit({ ...bill, paidAmount: 1000, status: "paid" }, 1)).toEqual({ ok: false, code: "bill_fully_paid" });
    expect(validateOpticalDeposit({ ...bill, status: "cancelled" }, 1)).toEqual({ ok: false, code: "bill_terminal" });
    expect(validateOpticalDeposit({ ...bill, status: "void" }, 1)).toEqual({ ok: false, code: "bill_terminal" });
    expect(validateOpticalDeposit({ ...bill, tenantId: "" }, 1)).toEqual({ ok: false, code: "invalid_bill" });
  });
  it("preserves cents for THB / USD and refuses non-exact currency precision", () => {
    const usd = { ...bill, currencyCode: "USD" as const, totalAmount: 25.50 };
    expect(validateOpticalDeposit(usd, 12.25)).toMatchObject({ ok: true, remainingAmount: 13.25 });
    expect(validateOpticalDeposit(usd, 12.256)).toEqual({ ok: false, code: "invalid_amount" });
  });
  it("QR only recalls partially paid bills, not paid, void or cancelled bills", () => {
    expect(buildOpticalBillRecallCode(bill)).toBeNull();
    const code = buildOpticalBillRecallCode(depositBill);
    expect(code).toBe("CPI-OPTICAL-RECALL:1:" + bill.orderId);
    expect(parseOpticalBillRecallCode(code!)).toBe(bill.orderId);
    expect(parseOpticalBillRecallCode("CPI-OPTICAL-RECALL:1:../../evil")).toBeNull();
    expect(opticalDepositReceiptCanRecall({ ...depositBill, status: "paid" })).toBe(false);
    expect(opticalDepositReceiptCanRecall({ ...depositBill, status: "cancelled" })).toBe(false);
    expect(opticalDepositReceiptCanRecall({ ...depositBill, status: "void" })).toBe(false);
  });
});

describe("Optical 80mm partial-payment receipt preview", () => {
  const receipt = {
    bill: depositBill,
    receiptNumber: "QA-DEPOSIT-0001",
    storeName: "IMDC OPTICAL",
    branchName: "QA Branch",
    createdAtIso: "2026-10-15T08:00:00Z",
    cashierName: "QA cashier",
    paymentMethod: "cash" as const,
    items: [{ description: "กรอบแว่นทดสอบ", quantity: 1, lineTotal: 1000 }]
  };
  it("prints full amount, paid amount, remainder and recall reference on 80mm", () => {
    const html = renderOpticalDepositReceipt80mm(receipt);
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("ใบเสร็จรับเงินมัดจำ");
    expect(html).toContain("ยอดค้างชำระ");
    expect(html).toContain("₭1,000");
    expect(html).toContain("₭500");
    expect(html).toContain(buildOpticalPickupBarcode(bill.orderId));
    expect(html).toContain('class="barcode"');
  });
  it("refuses unpaid/cancelled and allows fully paid receipt", () => {
    expect(() => renderOpticalDepositReceipt80mm({ ...receipt, bill })).toThrow("optical_receipt_requires_confirmed_payment");
    expect(renderOpticalDepositReceipt80mm({
      ...receipt, bill: { ...depositBill, paidAmount: 1000, status: "paid" }
    })).toContain("ใบเสร็จชำระเต็มจำนวน");
  });
  it("escapes customer product HTML and emits only generated barcode SVG", () => {
    const html = renderOpticalDepositReceipt80mm({
      ...receipt,
      customerLabel: "<script>alert(1)</script>",
      items: [{ description: "<img onerror=1>", quantity: 1, lineTotal: 1000 }],
      receiptWidthMm: 58
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
