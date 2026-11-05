import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getProductSpecialPrice,
  withProductRecommendedMetadata,
  withProductSpecialPriceMetadata
} from "../../src/lib/pos/product-metadata";

describe("native catalog special price contract", () => {
  it("retains other metadata and lets an owner clear a special price", () => {
    const original = { custom_flag: "kept", special_price: 75, is_recommended: true };
    const changed = withProductSpecialPriceMetadata(
      withProductRecommendedMetadata(original, false), 49.5
    );
    expect(getProductSpecialPrice(changed)).toBe(49.5);
    expect(changed.custom_flag).toBe("kept");
    expect(changed.is_recommended).toBe(false);
    const cleared = withProductSpecialPriceMetadata(changed, null);
    expect(getProductSpecialPrice(cleared)).toBeNull();
    expect(cleared.custom_flag).toBe("kept");
  });

  it("exposes special price through both authenticated mobile catalog routes", () => {
    const catalog = readFileSync("src/app/api/pos/catalog-management/route.ts", "utf8");
    const products = readFileSync("src/lib/services/pos-sales-mvp-service.ts", "utf8");
    expect(catalog).toContain("special_price: getProductSpecialPrice(row.metadata)");
    expect(catalog).toContain('Object.prototype.hasOwnProperty.call(body, "special_price")');
    expect(catalog).toContain("withProductSpecialPriceMetadata(nextMetadata, specialPrice)");
    expect(catalog).toContain('return fail("invalid_special_price")');
    expect(products).toContain("special_price: getProductSpecialPrice(row.metadata)");
  });
});
