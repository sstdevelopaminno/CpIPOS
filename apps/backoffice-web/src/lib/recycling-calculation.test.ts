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
  it("rejects zero, negative, nonfinite amounts and quantities", () => {
    expect(calculateRecyclingLine(0, "kg", 8, "kg")).toBeNull();
    expect(calculateRecyclingLine(-2, "kg", 8, "kg")).toBeNull();
    expect(calculateRecyclingLine(Infinity, "kg", 8, "kg")).toBeNull();
    expect(calculateRecyclingLine(1, "kg", -1, "kg")).toBeNull();
    expect(recyclingUnitLabel("khid")).toBe("ขีด");
  });
});
