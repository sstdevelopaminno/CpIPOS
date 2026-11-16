import { describe, expect, it } from "vitest";
import {
  ACCOUNTANT_MORE_MENU, ACCOUNTANT_SETTINGS_MENU, ACCOUNTANT_ALLOWED_MENU_KEYS,
  accountantMenuItem, isAccountantMenuVisible
} from "../../src/lib/accountant-menu-policy";

describe("accountant UI-only Finance role menu contract", () => {
  it("shows exactly five user-selected More items, without non-accounting POS menus", () => {
    expect(ACCOUNTANT_MORE_MENU.map(item => item.key)).toEqual([
      "more.sales_summary", "more.receipts", "more.tax_invoices",
      "more.stock", "more.product_sales"
    ]);
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("main.sales");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("main.shift");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("more.tables");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("more.kitchen_manage");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("settings.users");
  });
  it("includes all Settings except users and keeps package payment visible", () => {
    expect(ACCOUNTANT_SETTINGS_MENU).toHaveLength(18);
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).toContain("main.settings");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).toContain("main.package_payment");
    expect(accountantMenuItem("settings", "users")).toBeNull();
    expect(accountantMenuItem("more", "kitchen")).toBeNull();
  });
  it("respects IT denials without broadening accountant grants", () => {
    expect(isAccountantMenuVisible("more.receipts", {})).toBe(true);
    expect(isAccountantMenuVisible("more.receipts", { "main.more": false })).toBe(false);
    expect(isAccountantMenuVisible("main.package_payment", { "main.package_payment": false })).toBe(false);
    expect(isAccountantMenuVisible("settings.users", {})).toBe(false);
    expect(isAccountantMenuVisible("settings.store", { "main.finance": false })).toBe(false);
  });
});
