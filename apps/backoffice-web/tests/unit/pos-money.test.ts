import { describe, expect, it } from "vitest";
import { formatSalesMoney, normalizeSalesCurrency, orderCurrencyFromMetadata } from "../../src/lib/pos-money";

describe("per-sale currency presentation", () => {
  it("keeps legacy orders in THB without relabeling their original values", () => {
    expect(orderCurrencyFromMetadata(null)).toBe("THB");
    expect(orderCurrencyFromMetadata({})).toBe("THB");
    expect(orderCurrencyFromMetadata({ currency_code: "THB" })).toBe("THB");
    expect(orderCurrencyFromMetadata({ currency_code: "LAK" })).toBe("LAK");
    expect(orderCurrencyFromMetadata({ currency_code: "USD" })).toBe("USD");
    expect(orderCurrencyFromMetadata({ currency_code: "BOGUS" })).toBe("THB");
  });
  it("supports THB, LAK, USD ISO currency formatting without exchange conversion", () => {
    expect(normalizeSalesCurrency("USD")).toBe("USD");
    expect(formatSalesMoney(1250, "THB")).toBe("฿1,250.00");
    expect(formatSalesMoney(125000, "LAK")).toBe("₭125,000");
    expect(formatSalesMoney(25.5, "USD")).toBe("$25.50");
    expect(formatSalesMoney(Number.NaN, "LAK")).toBe("₭0");
  });
});
