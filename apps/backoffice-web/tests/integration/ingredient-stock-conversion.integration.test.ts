import { describe, expect, it } from "vitest";
import {
  calculateRecipeUsage,
  convertToGrams,
  deductStockForSale,
  formatStockDisplay,
  validateStockBeforeDeduction
} from "@/lib/ingredient-stock";

describe("ingredient stock conversion and deduction", () => {
  it("converts kilogram and gram correctly", () => {
    expect(convertToGrams(1, "kg")).toBe(1000);
    expect(convertToGrams(2.5, "kilogram")).toBe(2500);
    expect(convertToGrams(250, "gram")).toBe(250);
  });

  it("converts khid and decimal khid correctly", () => {
    expect(convertToGrams(0.5, "khid")).toBe(50);
    expect(convertToGrams(0.57, "khid")).toBe(57);
    expect(convertToGrams(1.25, "khid")).toBe(125);
    expect(convertToGrams(0.75, "khid")).toBe(75);
  });

  it("converts bag using weightPerBagInGrams", () => {
    expect(convertToGrams(1, "bag", { weightPerBagInGrams: 1000 })).toBe(1000);
    expect(convertToGrams(2, "bag", { weightPerBagInGrams: 1000 })).toBe(2000);
    expect(convertToGrams(1.5, "bag", { weightPerBagInGrams: 1000 })).toBe(1500);
  });

  it("calculates recipe usage in grams", () => {
    const usage = calculateRecipeUsage(
      [
        { productId: "p1", ingredientId: "veg", usageInGrams: 50 },
        { productId: "p1", ingredientId: "oil", usageInGrams: 10 }
      ],
      10
    );

    expect(usage).toEqual([
      { ingredientId: "veg", requiredGrams: 500 },
      { ingredientId: "oil", requiredGrams: 100 }
    ]);
  });

  it("deducts stock for sale and prevents negative stock by default", () => {
    const result = deductStockForSale(
      "noodle-small",
      10,
      [{ productId: "noodle-small", ingredientId: "veg", usageInGrams: 50 }],
      [{ id: "veg", name: "Vegetables", stockInGrams: 1000 }]
    );

    expect(result.deductions).toEqual([{ ingredientId: "veg", requiredGrams: 500, remainingGrams: 500 }]);
    expect(result.updatedIngredientStocks[0]?.stockInGrams).toBe(500);

    expect(() =>
      deductStockForSale(
        "noodle-medium",
        100,
        [{ productId: "noodle-medium", ingredientId: "veg", usageInGrams: 70 }],
        [{ id: "veg", name: "Vegetables", stockInGrams: 500 }]
      )
    ).toThrowError(/INSUFFICIENT_STOCK/);
  });

  it("supports negative stock when explicitly allowed", () => {
    const result = deductStockForSale(
      "p1",
      5,
      [{ productId: "p1", ingredientId: "veg", usageInGrams: 300 }],
      [{ id: "veg", name: "Vegetables", stockInGrams: 1000 }],
      { allowNegativeStock: true }
    );

    expect(result.updatedIngredientStocks[0]?.stockInGrams).toBe(-500);
  });

  it("validates stock and formats display text", () => {
    const valid = validateStockBeforeDeduction({ id: "veg", name: "Vegetables", stockInGrams: 1000 }, 700);
    expect(valid.ok).toBe(true);

    const invalid = validateStockBeforeDeduction({ id: "veg", name: "Vegetables", stockInGrams: 100 }, 200);
    expect(invalid.ok).toBe(false);

    expect(formatStockDisplay(1500, { locale: "en" })).toBe("1.5 kg");
    expect(formatStockDisplay(500, { locale: "en" })).toBe("500 g (5 khid)");
    expect(formatStockDisplay(50, { locale: "en" })).toBe("50 g (0.5 khid)");
  });

  it("aggregates shared recipe ingredients before reducing available stock", () => {
    const original = [
      { id: "veg", name: "Vegetables", stockInGrams: 1000 },
      { id: "oil", name: "Oil", stockInGrams: 150 }
    ];
    const result = deductStockForSale(
      "combo",
      3,
      [
        { productId: "combo", ingredientId: "veg", usageInGrams: 100 },
        { productId: "combo", ingredientId: "veg", usageInGrams: 20 },
        { productId: "combo", ingredientId: "oil", usageInGrams: 15 },
        { productId: "other-product", ingredientId: "oil", usageInGrams: 999 }
      ],
      original
    );
    expect(result.deductions).toEqual([
      { ingredientId: "veg", requiredGrams: 360, remainingGrams: 640 },
      { ingredientId: "oil", requiredGrams: 45, remainingGrams: 105 }
    ]);
    expect(original).toEqual([
      { id: "veg", name: "Vegetables", stockInGrams: 1000 },
      { id: "oil", name: "Oil", stockInGrams: 150 }
    ]);
  });

  it("fails the entire stock preview if one of several required ingredients is short", () => {
    const original = [
      { id: "veg", name: "Vegetables", stockInGrams: 1000 },
      { id: "oil", name: "Oil", stockInGrams: 10 }
    ];
    expect(() => deductStockForSale(
      "combo", 2,
      [
        { productId: "combo", ingredientId: "veg", usageInGrams: 50 },
        { productId: "combo", ingredientId: "oil", usageInGrams: 20 }
      ],
      original
    )).toThrowError(/INSUFFICIENT_STOCK:oil/);
    // Pure inventory calculations must never mutate the caller's on-screen stock.
    expect(original[0].stockInGrams).toBe(1000);
    expect(original[1].stockInGrams).toBe(10);
  });

  it("rejects invalid recipe unit conversions instead of showing false stock availability", () => {
    expect(() => convertToGrams(-1, "kg")).toThrowError(/INVALID_VALUE/);
    expect(() => convertToGrams(1, "bag", { weightPerBagInGrams: 0 })).toThrowError(/INVALID_WEIGHT_PER_BAG_IN_GRAMS/);
    expect(() => convertToGrams(Number.NaN, "g")).toThrowError(/INVALID_VALUE/);
  });
});
