import { describe, expect, it } from "vitest";
import { readLine, isRecyclingDirection, isRecyclingSettlement } from "../../src/lib/recycling-transaction-input";

const line = { product_id: "12345678-1234-4234-8234-123456789abc", unit: "kg", quantity: 1.25, expected_price: 12.5 };

describe("Recycling transaction input boundary", () => {
  it("accepts numeric and decimal string inputs without changing legitimate values", () => {
    expect(readLine(line)).toEqual(line);
    expect(readLine({...line, quantity: "1.25", expected_price: "12.50"})).toEqual(line);
    expect(readLine({...line, expected_price: 0})?.expected_price).toBe(0);
  });
  it("rejects coercible non-numeric JSON values and ambiguous strings", () => {
    for (const value of [null, true, false, [], [1], {}, "", " ", "0x10", "1e2", " 1 ", undefined]) {
      expect(readLine({...line, quantity: value})).toBeNull();
      expect(readLine({...line, expected_price: value})).toBeNull();
    }
  });
  it("preserves range, precision and whole-piece constraints", () => {
    for (const quantity of [0, -1, 100000001, 0.1234567, Infinity, NaN]) {
      expect(readLine({...line, quantity})).toBeNull();
    }
    for (const expected_price of [-1, 100000000, 1.123, Infinity, NaN]) {
      expect(readLine({...line, expected_price})).toBeNull();
    }
    expect(readLine({...line, unit: "piece", quantity: 1.5})).toBeNull();
    expect(readLine({...line, unit: "stem", quantity: 2})).not.toBeNull();
    expect(readLine({...line, product_id: "invalid"})).toBeNull();
    expect(readLine({...line, unit: "invalid"})).toBeNull();
  });
  it("does not coerce direction or settlement arrays", () => {
    expect(isRecyclingDirection("buy")).toBe(true);
    expect(isRecyclingDirection("sell")).toBe(true);
    expect(isRecyclingDirection(["buy"])).toBe(false);
    expect(isRecyclingSettlement("cash")).toBe(true);
    expect(isRecyclingSettlement("bank_transfer")).toBe(true);
    expect(isRecyclingSettlement("credit")).toBe(true);
    expect(isRecyclingSettlement(["cash"])).toBe(false);
    expect(isRecyclingSettlement(null)).toBe(false);
  });
});
