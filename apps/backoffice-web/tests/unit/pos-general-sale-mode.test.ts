import { describe, expect, it } from "vitest";
import {
  GENERAL_SALE_BUSINESS_GROUP,
  GENERAL_SALE_CHECKOUT_BASE_MODE,
  GENERAL_SALE_MODE_ID,
  GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE,
  GENERAL_SALE_ROOT_ATTRIBUTE,
  isExactGeneralSaleSkuMatch,
  normalizeGeneralSaleScanCode
} from "../../src/lib/pos-general-sale-mode";
import { getPosBusinessModeDefinition, isPosBusinessModeEnabled } from "../../src/lib/pos-business-mode";

describe("POS SD general sale mode helpers", () => {
  it("keeps SD as a separate business-mode identity on the Home checkout base", () => {
    expect(GENERAL_SALE_MODE_ID).toBe("general_sale");
    expect(GENERAL_SALE_BUSINESS_GROUP).toBe("SD");
    expect(GENERAL_SALE_CHECKOUT_BASE_MODE).toBe("home");
    expect(GENERAL_SALE_ROOT_ATTRIBUTE).toBe("data-pos-business-mode");
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

  it("normalizes scanner input without fuzzy product-name behavior", () => {
    expect(normalizeGeneralSaleScanCode("  ab-001  ")).toBe("AB-001");
    expect(normalizeGeneralSaleScanCode("ａｂ１２３")).toBe("AB123");
    expect(normalizeGeneralSaleScanCode(null)).toBe("");
  });

  it("matches SKU exactly after normalization", () => {
    expect(isExactGeneralSaleSkuMatch(" sku-001 ", "SKU-001")).toBe(true);
    expect(isExactGeneralSaleSkuMatch("SKU-001", "SKU-001-A")).toBe(false);
    expect(isExactGeneralSaleSkuMatch("001", "SKU-001")).toBe(false);
    expect(isExactGeneralSaleSkuMatch("", "SKU-001")).toBe(false);
  });
});
