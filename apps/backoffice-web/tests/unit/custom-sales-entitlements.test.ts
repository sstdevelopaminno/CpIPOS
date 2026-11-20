import { describe, expect, it } from "vitest";
import { hasCustomSalesModeFeatureGrant as allowed } from "../../src/lib/custom-sales-entitlements";

describe("CUSTOM sales entry entitlements", () => {
  it("permits explicitly granted general sale, optical, or recycling on CUSTOM", () => {
    for (const mode of ["general_sale", "optical_retail", "recycling"]) {
      expect(allowed("custom", { [mode]: true }, "core_pos_sales")).toBe(true);
      expect(allowed("custom", { [mode]: true }, "pos.sales.access")).toBe(true);
      expect(allowed("custom", { [mode]: true }, "barcode_scanner_mode")).toBe(true);
    }
  });
  it("does not authorize by the package alone or by unrelated modes", () => {
    expect(allowed("custom", null, "core_pos_sales")).toBe(false);
    expect(allowed("custom", {}, "core_pos_sales")).toBe(false);
    expect(allowed("custom", { takeaway: true }, "core_pos_sales")).toBe(false);
    expect(allowed("growth", { recycling: true }, "core_pos_sales")).toBe(false);
    expect(allowed("starter", { general_sale: true }, "core_pos_sales")).toBe(false);
    expect(allowed("custom", { recycling: false, general_sale: false }, "core_pos_sales")).toBe(false);
  });
  it("adds stock dependency only to Recycling, never other CUSTOM modes", () => {
    expect(allowed("custom", { recycling: true }, "stock_management")).toBe(true);
    expect(allowed("custom", { general_sale: true }, "stock_management")).toBe(false);
    expect(allowed("custom", { optical_retail: true }, "stock_management")).toBe(false);
    expect(allowed("custom", { recycling: true }, "user_management")).toBe(false);
  });
});
