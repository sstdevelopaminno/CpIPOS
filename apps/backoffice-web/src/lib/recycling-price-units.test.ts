import { describe, expect, it } from "vitest";
import { calculateRecyclingLine } from "./recycling-calculation";
import { formatRecyclingUnitPrice, parseRecyclingUnitPrice, getRecyclingPriceBasis } from "./recycling-price-units";
describe("Recycling price display units use canonical satang/kg ledger", () => {
  it("converts price/kg, price/khid and price/gram exactly", () => {
    expect(parseRecyclingUnitPrice("20", "kg")).toBe(20);
    expect(parseRecyclingUnitPrice("2", "khid")).toBe(20);
    expect(parseRecyclingUnitPrice("0.02", "g")).toBe(20);
    expect(parseRecyclingUnitPrice("0.00001", "g")).toBe(0.01);
    expect(parseRecyclingUnitPrice("0.001", "khid")).toBe(0.01);
    expect(parseRecyclingUnitPrice("0.12345", "g")).toBe(123.45);
  });
  it("rejects unsupported precision, out-of-range and nonnumeric amounts", () => {
    expect(parseRecyclingUnitPrice("0.123456", "g")).toBeNull();
    expect(parseRecyclingUnitPrice("1.0001", "khid")).toBeNull();
    expect(parseRecyclingUnitPrice("1.001", "kg")).toBeNull();
    expect(parseRecyclingUnitPrice("100000", "g")).toBeNull();
    expect(parseRecyclingUnitPrice("-2", "kg")).toBeNull();
    expect(parseRecyclingUnitPrice("1e3", "kg")).toBeNull();
    expect(parseRecyclingUnitPrice("", "kg")).toBeNull();
  });
  it("round-trips to canonical satang for every kg-priced input", () => {
    for(const canonical of [0.01,3.33,20.01,12345.67]) {
      for (const unit of ["kg","khid","g"] as const) {
        expect(parseRecyclingUnitPrice(formatRecyclingUnitPrice(canonical,unit),unit)).toBe(canonical);
      }
    }
    expect(formatRecyclingUnitPrice(20,"g")).toBe("0.02");
    expect(formatRecyclingUnitPrice(75,"khid")).toBe("7.5");
  });
  it("matches all mass-based basket amounts, without changing the quantity ledger", () => {
    const canonical = parseRecyclingUnitPrice("0.02","g")!;
    for(const [quantity,unit] of [[500,"g"],[5,"khid"],[0.5,"kg"]] as const) {
      expect(calculateRecyclingLine(quantity,unit,canonical,"kg")).toEqual({amount:10,basisQuantity:0.5});
    }
    expect(getRecyclingPriceBasis("g")).toBe("kg");
    expect(getRecyclingPriceBasis("piece")).toBe("piece");
  });
});
