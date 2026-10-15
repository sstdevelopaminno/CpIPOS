import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL("../../src/" + path, import.meta.url), "utf8");

describe("tenant currency across POS reports", () => {
  it("retains each bill's immutable currency through list, UI and CSV", () => {
    const service = read("lib/services/pos-sales-list-service.ts");
    const ui = read("components/pos-preview/pos-sales-list-workspace.tsx");
    expect(service).toContain("currencyCode: orderCurrencyFromMetadata(row.metadata)");
    expect(ui).toContain("row.currencyCode, paymentLabel(row.paymentStatus)");
    expect(ui).toContain("money(row.total, lang, row.currencyCode)");
    expect(ui).toContain("totals[row.currencyCode] +=");
    expect(ui).toContain("ไม่รวมยอด THB, LAK และ USD");
    expect(ui).not.toContain("฿${money(row.total, lang)}");
  });
  it("prevents cross-currency KPI aggregation in sales summary", () => {
    const server = read("lib/services/pos-sales-summary-service.ts");
    const ui = read("components/pos-preview/pos-sales-summary-dashboard.tsx");
    expect(server).toContain("const currencyCode = await getTenantPosCurrencyCode(scope.tenantId)");
    expect(server).toContain("orderCurrencyFromMetadata(order.metadata) === currencyCode");
    expect(server).toContain("currencyBuckets");
    expect(server).toContain("currencyCode: orderCurrencyFromMetadata(order.metadata)");
    expect(ui).toContain('data-testid="sales-summary-currency-ledger"');
    expect(ui).toContain("payload.currencyCode");
    expect(ui).not.toContain('currency: "THB"');
  });
});
