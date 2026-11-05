import { describe, expect, it } from "vitest";
import {
  getProductSpecialPrice,
  isProductRecommended,
  withProductManagementMetadata
} from "../../src/lib/pos/product-metadata";

describe("product special price metadata", () => {
  it("reads only finite non-negative optional prices", () => {
    expect(getProductSpecialPrice(null)).toBeNull();
    expect(getProductSpecialPrice({})).toBeNull();
    expect(getProductSpecialPrice({ special_price: "" })).toBeNull();
    expect(getProductSpecialPrice({ special_price: "39.50" })).toBe(39.5);
    expect(getProductSpecialPrice({ special_price: 0 })).toBe(0);
    expect(getProductSpecialPrice({ special_price: -1 })).toBeNull();
    expect(getProductSpecialPrice({ special_price: "not-a-number" })).toBeNull();
  });

  it("preserves unrelated product metadata while setting recommended and special price", () => {
    const next = withProductManagementMetadata(
      { custom_flag: "keep", recommended: false, special_price: 99 },
      { isRecommended: true, specialPrice: 45.25 }
    );

    expect(next.custom_flag).toBe("keep");
    expect(isProductRecommended(next)).toBe(true);
    expect(getProductSpecialPrice(next)).toBe(45.25);
  });

  it("removes only the special price when the field is cleared", () => {
    const next = withProductManagementMetadata(
      { custom_flag: "keep", special_price: 49 },
      { isRecommended: false, specialPrice: null }
    );

    expect(next.custom_flag).toBe("keep");
    expect(next).not.toHaveProperty("special_price");
    expect(isProductRecommended(next)).toBe(false);
  });
});
