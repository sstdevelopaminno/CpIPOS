import { describe, expect, it } from "vitest";
import {
  GROCERY_MODE_ID,
  GROCERY_PRODUCT_SKU_ATTRIBUTE,
  GROCERY_ROOT_ATTRIBUTE,
  isExactGrocerySkuMatch,
  normalizeGroceryScanCode
} from "../../src/lib/pos-grocery-mode";

describe("POS grocery mode helpers", () => {
  it("keeps grocery as a separate UI/business-mode identity", () => {
    expect(GROCERY_MODE_ID).toBe("grocery");
    expect(GROCERY_ROOT_ATTRIBUTE).toBe("data-pos-business-mode");
    expect(GROCERY_PRODUCT_SKU_ATTRIBUTE).toBe("data-pos-product-sku");
  });

  it("normalizes scanner input without fuzzy product-name behavior", () => {
    expect(normalizeGroceryScanCode("  ab-001  ")).toBe("AB-001");
    expect(normalizeGroceryScanCode("ａｂ１２３")).toBe("AB123");
    expect(normalizeGroceryScanCode(null)).toBe("");
  });

  it("matches SKU exactly after normalization", () => {
    expect(isExactGrocerySkuMatch(" sku-001 ", "SKU-001")).toBe(true);
    expect(isExactGrocerySkuMatch("SKU-001", "SKU-001-A")).toBe(false);
    expect(isExactGrocerySkuMatch("001", "SKU-001")).toBe(false);
    expect(isExactGrocerySkuMatch("", "SKU-001")).toBe(false);
  });
});
