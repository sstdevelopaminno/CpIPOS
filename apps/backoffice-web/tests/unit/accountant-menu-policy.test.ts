import { describe, expect, it } from "vitest";
import {
  ACCOUNTANT_MORE_MENU, ACCOUNTANT_SETTINGS_MENU, ACCOUNTANT_ALLOWED_MENU_KEYS,
  accountantMenuItem, isAccountantMenuVisible
} from "../../src/lib/accountant-menu-policy";

describe("accountant UI-only Finance role menu contract", () => {
  it("shows only finance-relevant More items, excluding product master data", () => {
    expect(ACCOUNTANT_MORE_MENU.map(item => item.key)).toEqual([
      "more.sales_summary", "more.receipts", "more.tax_invoices",
      "more.product_sales"
    ]);
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("more.stock");
    expect(accountantMenuItem("more", "stock")).toBeNull();
    expect(isAccountantMenuVisible("more.stock", {})).toBe(false);
    expect(ACCOUNTANT_MORE_MENU.find(item => item.slug === "product-sales")?.label).toBe("รายงานรายการขาย");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("main.sales");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("main.shift");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("more.tables");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("more.kitchen_manage");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("settings.users");
  });
  it("allows only finance-relevant Settings and keeps package payment visible", () => {
    expect(ACCOUNTANT_SETTINGS_MENU.map(item => item.slug)).toEqual([
      "branding", "store", "printers", "payments", "taxes",
      "support", "push-notifications", "language", "currency", "placement"
    ]);
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).toContain("main.settings");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).toContain("main.package_payment");
    expect(accountantMenuItem("settings", "users")).toBeNull();
    expect(accountantMenuItem("more", "kitchen")).toBeNull();
  });
  it("hides all eight operational Settings entries and rejects their direct routes", () => {
    const excluded: Array<[string, string]> = [
      ["settings.inet_nops", "inet-nops"],
      ["settings.notifications", "notifications"],
      ["settings.display", "display"],
      ["settings.order_kitchen", "order-kitchen"],
      ["settings.table_qr", "table-qr"],
      ["settings.activity", "activity"],
      ["settings.devices", "devices"],
      ["settings.branches", "branches"]
    ];
    for (const [key, slug] of excluded) {
      expect(ACCOUNTANT_SETTINGS_MENU.some(item => item.key === key)).toBe(false);
      expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain(key);
      expect(accountantMenuItem("settings", slug)).toBeNull();
      expect(isAccountantMenuVisible(key, {})).toBe(false);
      expect(isAccountantMenuVisible(key, { [key]: true })).toBe(false);
    }
  });
  it("respects IT denials without broadening accountant grants", () => {
    expect(isAccountantMenuVisible("more.receipts", {})).toBe(true);
    expect(isAccountantMenuVisible("more.receipts", { "main.more": false })).toBe(false);
    expect(isAccountantMenuVisible("main.package_payment", { "main.package_payment": false })).toBe(false);
    expect(isAccountantMenuVisible("settings.users", {})).toBe(false);
    expect(isAccountantMenuVisible("settings.store", { "main.finance": false })).toBe(false);
  });
});
