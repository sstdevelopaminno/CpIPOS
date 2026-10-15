/**
 * Per-sale currency presentation. These helpers NEVER convert amounts:
 * a transaction's stored currency snapshot is authoritative.
 * Orders created before snapshots existed were THB.
 *
 * USD is supported for display/reporting, NOT automatically approved for
 * checkout; a separate IT, payment, fiscal and stock cutover is required.
 */
export type SalesCurrencyCode = "THB" | "LAK" | "USD";

export function normalizeSalesCurrency(value: unknown): SalesCurrencyCode {
  return value === "LAK" || value === "USD" ? value : "THB";
}

export function orderCurrencyFromMetadata(metadata: unknown): SalesCurrencyCode {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "THB";
  const value = (metadata as Record<string, unknown>).currency_code;
  return normalizeSalesCurrency(value);
}

const currencySymbols: Record<SalesCurrencyCode, string> = {
  THB: "฿", LAK: "₭", USD: "$"
};

export function formatSalesMoney(
  value: number,
  code: SalesCurrencyCode,
  locale: string = "en-US"
): string {
  const digits = code === "LAK" ? 0 : 2;
  return currencySymbols[code] + new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

export function addSalesAmountToCurrencyBucket(
  buckets: Record<SalesCurrencyCode, number>,
  code: SalesCurrencyCode,
  value: number
): void {
  buckets[code] += Number.isFinite(value) ? value : 0;
}
