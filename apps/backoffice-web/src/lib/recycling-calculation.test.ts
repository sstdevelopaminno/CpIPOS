import { describe, expect, it } from "vitest";
import { calculateRecyclingLine, recyclingUnitLabel } from "./recycling-calculation";

describe("recycling calculation preview", () => {
  it("uses the stock price per kg for external scale quantities", () => {
    expect(calculateRecyclingLine(125.5, "kg", 8.5, "kg")).toEqual({ amount: 1066.75, basisQuantity: 125.5 });
    expect(calculateRecyclingLine(5, "khid", 20, "kg")?.amount).toBe(10);
    expect(calculateRecyclingLine(500, "g", 20, "kg")?.amount).toBe(10);
    expect(calculateRecyclingLine(1, "ton", 8, "kg")?.amount).toBe(8000);
  });
  it("accepts only whole pieces for count-based products", () => {
    expect(calculateRecyclingLine(1, "piece", 200, "piece")?.amount).toBe(200);
    expect(calculateRecyclingLine(1.5, "piece", 200, "piece")).toBeNull();
    expect(calculateRecyclingLine(1, "kg", 200, "piece")).toBeNull();
    expect(calculateRecyclingLine(1, "piece", 200, "kg")).toBeNull();
  });
  it("rounds to satang exactly the same way as PostgreSQL numeric", () => {
    // 0.5 kg x 3.01 THB/kg = 1.505 THB => 1.51 (half-up).
    expect(calculateRecyclingLine(0.5, "kg", 3.01, "kg")).toEqual({
      amount: 1.51, basisQuantity: 0.5
    });
    // 1500 grams, total 30.00 THB at 20 THB/kg.
    expect(calculateRecyclingLine(1500, "g", 20, "kg")).toEqual({
      amount: 30, basisQuantity: 1.5
    });
    expect(calculateRecyclingLine(0.001, "kg", 10, "kg")).toEqual({
      amount: 0.01, basisQuantity: 0.001
    });
  });
  it("does not silently round weight below the supported precision", () => {
    expect(calculateRecyclingLine(0.5, "g", 20, "kg")).toBeNull();
    expect(calculateRecyclingLine(0.0001, "kg", 20, "kg")).toBeNull();
    expect(calculateRecyclingLine(1, "g", 0.01, "kg")).toBeNull();
    expect(calculateRecyclingLine(1, "kg", 0.001, "kg")).toBeNull();
  });

  it("rejects zero, negative, nonfinite amounts and quantities", () => {
    expect(calculateRecyclingLine(0, "kg", 8, "kg")).toBeNull();
    expect(calculateRecyclingLine(-2, "kg", 8, "kg")).toBeNull();
    expect(calculateRecyclingLine(Infinity, "kg", 8, "kg")).toBeNull();
    expect(calculateRecyclingLine(1, "kg", -1, "kg")).toBeNull();
    expect(recyclingUnitLabel("khid")).toBe("ขีด");
  });
});
