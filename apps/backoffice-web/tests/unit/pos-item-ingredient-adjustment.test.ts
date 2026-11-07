import { describe, expect, it } from "vitest";
import { validatePosItemIngredientAdjustment } from "@/lib/pos-item-ingredient-adjustment";

const productId = "11111111-1111-4111-8111-111111111111";
const ingredientA = "22222222-2222-4222-8222-222222222222";
const ingredientB = "33333333-3333-4333-8333-333333333333";

const valid = {
  product_id: productId,
  quantity: 2,
  mode: "deduct",
  ingredient_ids: [ingredientA],
  note: "Line adjustment"
};

describe("manual POS recipe ingredient adjustment request validation", () => {
  it("accepts explicitly selected ingredients for deduction", () => {
    expect(validatePosItemIngredientAdjustment(valid)).toEqual({
      ok: true, data: valid
    });
  });

  it("accepts legitimate fractional quantities and explicit restore mode", () => {
    expect(validatePosItemIngredientAdjustment({
      ...valid, quantity: 0.5, mode: "restore", ingredient_ids: [ingredientA, ingredientB, ingredientA]
    })).toMatchObject({
      ok: true,
      data: { quantity: 0.5, mode: "restore", ingredient_ids: [ingredientA, ingredientB] }
    });
  });

  it.each([
    ["missing body", null],
    ["empty selection", { ...valid, ingredient_ids: [] }],
    ["omitted selection", { ...valid, ingredient_ids: undefined }],
    ["invalid second selection", { ...valid, ingredient_ids: [ingredientA, "bad-ingredient"] }],
    ["missing mode", { ...valid, mode: undefined }],
    ["invalid mode", { ...valid, mode: "restroe" }],
    ["missing product", { ...valid, product_id: "" }],
    ["negative quantity", { ...valid, quantity: -2 }],
    ["infinite quantity", { ...valid, quantity: Number.POSITIVE_INFINITY }],
    ["nonnumeric quantity", { ...valid, quantity: "NaN" }],
    ["oversized quantity", { ...valid, quantity: 10000 }],
    ["overlong note", { ...valid, note: "x".repeat(241) }]
  ])("rejects %s to prevent unintended stock writes", async (_label, payload) => {
    const result = validatePosItemIngredientAdjustment(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });
});
