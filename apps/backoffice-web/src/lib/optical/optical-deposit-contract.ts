/**
 * Optical-only business rules. Pure functions: NO shared restaurant order/status,
 * payment, stock, shift, printing or subscription mutations.
 *
 * On a real checkout, backend must enforce the same rules under a row lock in
 * one tenant+branch-scoped DB transaction, with a unique idempotency key.
 * Display validation here is NOT a substitute for the server financial ledger.
 */
import { type SalesCurrencyCode } from "@/lib/pos-money";

export type OpticalBillStatus =
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "void";

export type OpticalBillSnapshot = {
  tenantId: string;
  branchId: string;
  orderId: string;
  currencyCode: SalesCurrencyCode;
  totalAmount: number;
  paidAmount: number;
  status: OpticalBillStatus;
};

export type OpticalDepositValidation =
  | { ok: true; amount: number; remainingAmount: number; nextStatus: "partially_paid" | "paid" }
  | { ok: false; code:
      | "invalid_amount"
      | "invalid_bill"
      | "bill_terminal"
      | "bill_fully_paid"
      | "deposit_exceeds_balance"
    };

function unitsPerCurrency(currencyCode: SalesCurrencyCode): number {
  return currencyCode === "LAK" ? 1 : 100;
}

function toExactUnits(value: number, currency: SalesCurrencyCode): number | null {
  const scale = unitsPerCurrency(currency);
  const converted = value * scale;
  if (!Number.isFinite(converted) || !Number.isSafeInteger(Math.round(converted))) return null;
  const rounded = Math.round(converted);
  if (Math.abs(converted - rounded) > 0.000001 || rounded < 0) return null;
  return rounded;
}

export function validateOpticalDeposit(
  bill: OpticalBillSnapshot,
  incomingAmount: number
): OpticalDepositValidation {
  if (!bill.tenantId || !bill.branchId || !bill.orderId) return { ok: false, code: "invalid_bill" };
  if (bill.status === "cancelled" || bill.status === "void") return { ok: false, code: "bill_terminal" };
  if (bill.status === "paid") return { ok: false, code: "bill_fully_paid" };
  const total = toExactUnits(bill.totalAmount, bill.currencyCode);
  const paid = toExactUnits(bill.paidAmount, bill.currencyCode);
  const incoming = toExactUnits(incomingAmount, bill.currencyCode);
  if (total === null || total <= 0 || paid === null || paid > total) return { ok: false, code: "invalid_bill" };
  if (incoming === null || incoming <= 0) return { ok: false, code: "invalid_amount" };
  if (paid === total) return { ok: false, code: "bill_fully_paid" };
  if (bill.status === "unpaid" && paid !== 0) return { ok: false, code: "invalid_bill" };
  if (bill.status === "partially_paid" && (paid === 0 || paid === total)) return { ok: false, code: "invalid_bill" };
  if (incoming > total - paid) return { ok: false, code: "deposit_exceeds_balance" };
  const remaining = total - paid - incoming;
  const scale = unitsPerCurrency(bill.currencyCode);
  return {
    ok: true,
    amount: incoming / scale,
    remainingAmount: remaining / scale,
    nextStatus: remaining === 0 ? "paid" : "partially_paid"
  };
}

/**
 * The QR is a locator ONLY, not a bearer token, payment authorization, or
 * proof of ownership. Always resolve via an authenticated server endpoint
 * checking tenantId, branchId, RBAC and an unpaid partial-payment ledger.
 */
export function opticalDepositReceiptCanRecall(bill: OpticalBillSnapshot): boolean {
  const total = toExactUnits(bill.totalAmount, bill.currencyCode);
  const paid = toExactUnits(bill.paidAmount, bill.currencyCode);
  return bill.status === "partially_paid" &&
    total !== null && paid !== null && paid > 0 && paid < total;
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const prefix = "CPI-OPTICAL-RECALL:1:";

export function buildOpticalBillRecallCode(bill: OpticalBillSnapshot): string | null {
  if (!opticalDepositReceiptCanRecall(bill) || !uuidRegex.test(bill.orderId)) return null;
  return prefix + bill.orderId.toLowerCase();
}

export function parseOpticalBillRecallCode(value: string): string | null {
  if (!value.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  return uuidRegex.test(id) ? id.toLowerCase() : null;
}
