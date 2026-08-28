import { describe, expect, it } from "vitest";
import {
  GENERAL_SALE_BUSINESS_GROUP,
  GENERAL_SALE_CHECKOUT_BASE_MODE,
  GENERAL_SALE_LAYOUT_ATTRIBUTE,
  GENERAL_SALE_LAYOUT_STORAGE_KEY,
  GENERAL_SALE_MODE_ID,
  GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE,
  GENERAL_SALE_ROOT_ATTRIBUTE,
  isExactGeneralSaleSkuMatch,
  normalizeGeneralSaleCartLayout,
  normalizeGeneralSaleScanCode
} from "../../src/lib/pos-general-sale-mode";
import { getPosBusinessModeDefinition, isPosBusinessModeEnabled } from "../../src/lib/pos-business-mode";

describe("POS SD general sale mode helpers", () => {
  it("keeps SD as a separate business-mode identity on the Home checkout base", () => {
    expect(GENERAL_SALE_MODE_ID).toBe("general_sale");
    expect(GENERAL_SALE_BUSINESS_GROUP).toBe("SD");
    expect(GENERAL_SALE_CHECKOUT_BASE_MODE).toBe("home");
    expect(GENERAL_SALE_ROOT_ATTRIBUTE).toBe("data-pos-business-mode");
    expect(GENERAL_SALE_LAYOUT_ATTRIBUTE).toBe("data-pos-general-sale-layout");
    expect(GENERAL_SALE_LAYOUT_STORAGE_KEY).toBe("cpipos_general_sale_layout_v1");
    expect(GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE).toBe("data-pos-product-sku");
  });

  it("maps FG, FF and SD independently from transaction order_type", () => {
    expect(getPosBusinessModeDefinition("home").group).toBe("FG");
    expect(getPosBusinessModeDefinition("buffet_table").group).toBe("FF");
    expect(getPosBusinessModeDefinition("general_sale").group).toBe("SD");
    expect(getPosBusinessModeDefinition("general_sale").checkoutBaseMode).toBe("home");
  });

  it("fails closed for SD unless its package feature is explicitly enabled", () => {
    expect(isPosBusinessModeEnabled("general_sale", null)).toBe(false);
    expect(isPosBusinessModeEnabled("general_sale", {})).toBe(false);
    expect(isPosBusinessModeEnabled("general_sale", { barcode_scanner_mode: false })).toBe(false);
    expect(isPosBusinessModeEnabled("general_sale", { barcode_scanner_mode: true })).toBe(true);
  });

  it("normalizes the two SD cart layouts with grid as the safe default", () => {
    expect(normalizeGeneralSaleCartLayout("grid")).toBe("grid");
    expect(normalizeGeneralSaleCartLayout("table")).toBe("table");
    expect(normalizeGeneralSaleCartLayout("unknown")).toBe("grid");
    expect(normalizeGeneralSaleCartLayout(null)).toBe("grid");
  });

  it("normalizes scans with the same digit-first SKU rule used by Product Management", () => {
    expect(normalizeGeneralSaleScanCode("  097339  ")).toBe("097339");
    expect(normalizeGeneralSaleScanCode("PRD-ก๋วยเตี๋ยว-097339")).toBe("097339");
    expect(normalizeGeneralSaleScanCode("ａｂ１２３")).toBe("123");
    expect(normalizeGeneralSaleScanCode("NO-DIGITS")).toBe("NO-DIGITS");
    expect(normalizeGeneralSaleScanCode(null)).toBe("");
  });

  it("matches canonical scanner SKU against an exact normalized legacy SKU only", () => {
    expect(isExactGeneralSaleSkuMatch("097339", "097339")).toBe(true);
    expect(isExactGeneralSaleSkuMatch("097339", "PRD-ก๋วยเตี๋ยว-097339")).toBe(true);
    expect(isExactGeneralSaleSkuMatch("097339", "PRD-ก๋วยเตี๋ยว-1097339")).toBe(false);
    expect(isExactGeneralSaleSkuMatch("", "097339")).toBe(false);
  });
});
