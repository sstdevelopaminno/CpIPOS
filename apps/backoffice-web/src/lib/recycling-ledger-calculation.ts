/**
 * Pure checks shared by staging UAT tests. This module never writes money,
 * inventory or GL; the atomic Postgres RPC is the system of record.
 * All monetary amounts are satang; mass is measured in micro-kilograms.
 */
export type RecyclingSettlement = "cash" | "bank_transfer" | "credit";
export type RecyclingDirection = "buy" | "sell";
export type RecyclingLedgerRow = { code: string; debit: bigint; credit: bigint };

export function applyStockValuation(
  direction: RecyclingDirection,
  stockQuantityMicro: bigint,
  stockCostMinor: bigint,
  lineQuantityMicro: bigint,
  lineAmountMinor: bigint
): { quantityMicro: bigint; carryingCostMinor: bigint; cogsMinor: bigint } {
  if (stockQuantityMicro < 0n || stockCostMinor < 0n ||
      lineQuantityMicro <= 0n || lineAmountMinor <= 0n) {
    throw new Error("invalid_stock_amount");
  }
  if (direction === "buy") {
    return {
      quantityMicro: stockQuantityMicro + lineQuantityMicro,
      carryingCostMinor: stockCostMinor + lineAmountMinor,
      cogsMinor: 0n
    };
  }
  if (lineQuantityMicro > stockQuantityMicro) throw new Error("recycling_stock_insufficient");
  const cogsMinor = stockQuantityMicro === lineQuantityMicro ? stockCostMinor
    : (stockCostMinor * lineQuantityMicro * 2n + stockQuantityMicro) /
      (stockQuantityMicro * 2n);
  return {
    quantityMicro: stockQuantityMicro - lineQuantityMicro,
    carryingCostMinor: stockCostMinor - cogsMinor,
    cogsMinor
  };
}

export function getRecyclingLedgerRows(
  direction: RecyclingDirection,
  settlement: RecyclingSettlement,
  totalMinor: bigint,
  cogsMinor: bigint
): RecyclingLedgerRow[] {
  if (totalMinor <= 0n || cogsMinor < 0n || (direction === "buy" && cogsMinor !== 0n)) {
    throw new Error("invalid_financial_amount");
  }
  const settlementCode = settlement === "cash" ? "1100"
    : settlement === "bank_transfer" ? "1110"
    : direction === "buy" ? "2100" : "1201";
  const rows: RecyclingLedgerRow[] = direction === "buy"
    ? [{ code: "1200", debit: totalMinor, credit: 0n },
       { code: settlementCode, debit: 0n, credit: totalMinor }]
    : [{ code: settlementCode, debit: totalMinor, credit: 0n },
       { code: "4100", debit: 0n, credit: totalMinor }];
  if (direction === "sell" && cogsMinor > 0n) {
    rows.push({ code: "5100", debit: cogsMinor, credit: 0n },
      { code: "1200", debit: 0n, credit: cogsMinor });
  }
  return rows;
}

export function isBalanced(rows: RecyclingLedgerRow[]): boolean {
  const debit = rows.reduce((s, row) => s + row.debit, 0n);
  const credit = rows.reduce((s, row) => s + row.credit, 0n);
  return debit > 0n && debit === credit && rows.every(row =>
    (row.debit > 0n && row.credit === 0n) || (row.credit > 0n && row.debit === 0n));
}
