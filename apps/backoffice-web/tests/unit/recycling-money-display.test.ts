import { describe, expect, it } from "vitest";
import { formatRecyclingMoney, formatRecyclingUnitPriceDisplay } from "../../src/lib/recycling-money-display";
import { formatRecyclingUnitPrice } from "../../src/lib/recycling-price-units";

describe("Recycling money display", () => {
  it("groups baht amounts with two decimals", () => {
    expect(formatRecyclingMoney(4000000)).toBe("4,000,000.00");
    expect(formatRecyclingMoney("3998562.75")).toBe("3,998,562.75");
    expect(formatRecyclingMoney(1437.25)).toBe("1,437.25");
    expect(formatRecyclingMoney(0)).toBe("0.00");
    expect(formatRecyclingMoney(-1234.5)).toBe("-1,234.50");
  });
  it("does not turn unknown amounts into zero", () => {
    for (const value of [null, undefined, "", " ", NaN, Infinity, false]) {
      expect(formatRecyclingMoney(value, "รอตรวจสอบ")).toBe("รอตรวจสอบ");
    }
  });
  it("groups display prices without altering exact unit conversion or editable inputs", () => {
    expect(formatRecyclingUnitPriceDisplay(1234.5, "kg")).toBe("1,234.50");
    expect(formatRecyclingUnitPriceDisplay(12.34, "g")).toBe("0.01234");
    expect(formatRecyclingUnitPriceDisplay(12.34, "khid")).toBe("1.234");
    expect(formatRecyclingUnitPrice(1234.5, "kg")).toBe("1234.5");
    expect(formatRecyclingUnitPriceDisplay(null, "kg")).toBe("");
  });
});
