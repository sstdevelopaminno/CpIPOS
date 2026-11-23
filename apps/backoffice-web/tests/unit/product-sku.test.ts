import { describe, expect, it } from "vitest";
import { isValidProductSku, normalizeProductSku, selectedProductSku } from "../../src/lib/product-sku";

describe("product SKU editing / barcode printing", () => {
  it("preserves leading zeros and alphanumeric codes for exact scans", () => {
    expect(normalizeProductSku("  0012345678905  ")).toBe("0012345678905");
    expect(normalizeProductSku(" ab-001_s.2 ")).toBe("AB-001_S.2");
    expect(isValidProductSku("AB-001_S.2")).toBe(true);
  });
  it("rejects non-printable / ambiguous codes", () => {
    for(const value of ["", "a b", "รหัส123", "A/B", "A%5", "A".repeat(41)]) {
      expect(isValidProductSku(value)).toBe(false);
    }
  });
  it("supports automatic, manual, and both without silently dropping user code", () => {
    const generated=()=> "123450001";
    expect(selectedProductSku({mode:"auto",sku:"USER-1"},generated)).toBe("123450001");
    expect(selectedProductSku({mode:"manual",sku:"A-001"},generated)).toBe("A-001");
    expect(selectedProductSku({mode:"manual",sku:""},generated)).toBeNull();
    expect(selectedProductSku({mode:"both",sku:""},generated)).toBe("123450001");
    expect(selectedProductSku({mode:"both",sku:"0001"},generated)).toBe("0001");
  });
});
