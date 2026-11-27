import { describe, expect, it } from "vitest";
import { hasCustomSalesModeFeatureGrant as allowed, hasCustomGroceryModuleGrant as moduleAllowed, hasCustomGroceryNotificationSettingsGrant as notificationAllowed } from "../../src/lib/custom-sales-entitlements";

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

const allMenus = {
  "main.more": true, "more.stock": true, "more.receipts": true,
  "main.sales_list": true, "more.sales_summary": true, "more.product_sales": true,
  "main.settings": true, "settings.branches": true, "settings.users": true,
  "settings.display": true, "settings.notifications": true
};
const groceryModule = (featureCode: string, overrides: Partial<Parameters<typeof moduleAllowed>[0]> = {}) => moduleAllowed({
  packageCode: "custom", rawModes: { general_sale: true }, featureCode,
  menuPolicy: allMenus, explicitFeatureDecision: false, ...overrides
});
describe("CUSTOM grocery IT-approved module grants", () => {
  it.each(["stock_management", "receipt_reprint_history", "advanced_sales_reports", "branch_management", "user_management", "customer_facing_display"])("grants %s with full IT approval and no feature row", feature => {
    expect(groceryModule(feature)).toBe(true);
    expect(groceryModule(feature, { explicitFeatureDecision: true })).toBe(false);
    expect(groceryModule(feature, { packageCode: "growth" })).toBe(false);
    expect(groceryModule(feature, { rawModes: { recycling: true } })).toBe(false);
    expect(groceryModule(feature, { rawModes: { general_sale: true, optical_retail: true } })).toBe(false);
    expect(groceryModule(feature, { rawModes: { general_sale: true, recycling: true } })).toBe(false);
    expect(groceryModule(feature, { rawModes: { general_sale: "true" } })).toBe(false);
    expect(groceryModule(feature, { menuPolicy: {} })).toBe(false);
  });
  it("requires the entire report bundle, not one isolated report", () => {
    for (const key of ["main.sales_list", "more.sales_summary", "more.product_sales", "main.more"]) {
      expect(groceryModule("advanced_sales_reports", { menuPolicy: { ...allMenus, [key]: false } })).toBe(false);
    }
  });
  it("requires the individual stock or receipt menu and parent, not other menu approvals", () => {
    expect(groceryModule("stock_management", { menuPolicy: { "main.more": true, "more.stock": true } })).toBe(true);
    expect(groceryModule("receipt_reprint_history", { menuPolicy: { "main.more": true, "more.receipts": true } })).toBe(true);
    expect(groceryModule("stock_management", { menuPolicy: { "more.stock": true } })).toBe(false);
    expect(groceryModule("receipt_reprint_history", { menuPolicy: { ...allMenus, "more.receipts": false } })).toBe(false);
  });
  it("never grants unrelated features from grocery menus", () => {
    for (const feature of ["cpipos_ai", "qr_table_ordering", "table_management", "delivery_ordering", "finance", "toString"]) {
      expect(groceryModule(feature)).toBe(false);
    }
  });
});

describe("CUSTOM grocery settings", () => {
  it.each([["branch_management", "settings.branches"], ["user_management", "settings.users"], ["customer_facing_display", "settings.display"]])("requires the exact IT settings menu and parent for %s", (feature, menu) => {
    expect(groceryModule(feature, { menuPolicy: { "main.settings": true, [menu]: true } })).toBe(true);
    expect(groceryModule(feature, { menuPolicy: { [menu]: true } })).toBe(false);
    expect(groceryModule(feature, { menuPolicy: { ...allMenus, [menu]: false } })).toBe(false);
  });
  it("permits only notification settings, not restaurant QR ordering", () => {
    const args = { packageCode: "custom", rawModes: { general_sale: true }, menuPolicy: allMenus, explicitFeatureDecision: false };
    expect(notificationAllowed(args)).toBe(true);
    expect(notificationAllowed({ ...args, explicitFeatureDecision: true })).toBe(false);
    expect(notificationAllowed({ ...args, packageCode: "business" })).toBe(false);
    expect(notificationAllowed({ ...args, rawModes: { recycling: true } })).toBe(false);
    expect(notificationAllowed({ ...args, menuPolicy: { "settings.notifications": true } })).toBe(false);
    expect(notificationAllowed({ ...args, menuPolicy: { ...allMenus, "settings.notifications": false } })).toBe(false);
    expect(groceryModule("qr_table_ordering")).toBe(false);
  });
});
