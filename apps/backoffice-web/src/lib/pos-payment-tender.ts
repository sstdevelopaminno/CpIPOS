import type { PaymentMethod } from "@pos/shared-types";

export type PosTenderLine = { method: PaymentMethod; amount: number };

/** Determine cash handling and transfer authorization from EVERY tender line. */
export function summarizePosTender(lines: readonly PosTenderLine[], cashReceived?: unknown) {
  const amount = (method: PaymentMethod) =>
    Math.round(lines.filter(line => line.method === method)
      .reduce((sum, line) => sum + Number(line.amount ?? 0), 0) * 100) / 100;
  const cashDue = amount("cash");
  const transferDue = amount("bank_transfer");
  const hasCash = lines.some(line => line.method === "cash");
  const hasBankTransfer = lines.some(line => line.method === "bank_transfer");
  // A bank transfer is not banknotes received by the cashier.
  const cashReceivedAmount = hasCash ? Number(cashReceived ?? cashDue) : 0;
  const changeAmount = Math.round(Math.max(0, cashReceivedAmount - cashDue) * 100) / 100;
  return { hasCash, hasBankTransfer, cashDue, transferDue, cashReceivedAmount, changeAmount };
}
