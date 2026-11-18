import { describe, expect, it } from "vitest";
import {
  ACCOUNTANT_FINANCE_MENU, ACCOUNTANT_SETTINGS_MENU, ACCOUNTANT_ALLOWED_MENU_KEYS,
  accountantFinanceModule, accountantMenuItem, isAccountantMenuVisible
} from "../../src/lib/accountant-menu-policy";

describe("Accountant Finance role navigation and deny-by-default contract", () => {
  it("exposes exactly seven Finance modules in the required order", () => {
    expect(ACCOUNTANT_FINANCE_MENU.map(item => [item.slug, item.label])).toEqual([
      ["income", "รายรับ"],
      ["expenses", "รายจ่าย"],
      ["sales-receivables", "งานขายและลูกหนี้"],
      ["purchases-payables", "งานซื้อและเจ้าหนี้"],
      ["banking", "การเงินและธนาคาร"],
      ["ledger", "บัญชีแยกประเภท"],
      ["tax-reports", "ภาษีและรายงาน"]
    ]);
    for (const item of ACCOUNTANT_FINANCE_MENU) {
      expect(accountantFinanceModule(item.slug)).toEqual(item);
      expect(isAccountantMenuVisible(item.key, {})).toBe(true);
      expect(isAccountantMenuVisible(item.key, { "main.finance": false })).toBe(false);
      expect(isAccountantMenuVisible(item.key, { [item.key]: false })).toBe(false);
    }
    expect(accountantFinanceModule("invalid")).toBeNull();
  });
  it("removes all legacy More navigation and URL grants, even under IT overrides", () => {
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("main.more");
    for (const key of ["more.sales_summary", "more.receipts", "more.tax_invoices",
      "more.product_sales", "more.stock", "main.sales", "main.shift",
      "more.tables", "more.kitchen_manage"]) {
      expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain(key);
      expect(isAccountantMenuVisible(key, { [key]: true })).toBe(false);
    }
    for (const slug of ["sales-summary", "receipts", "tax-invoices", "product-sales", "stock"]) {
      expect(accountantMenuItem("more", slug)).toBeNull();
    }
  });
  it("retains only the ten Accountant settings and package access", () => {
    expect(ACCOUNTANT_SETTINGS_MENU.map(item => item.slug)).toEqual([
      "branding", "store", "printers", "payments", "taxes",
      "support", "push-notifications", "language", "currency", "placement"
    ]);
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).toContain("main.settings");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).toContain("main.package_payment");
    expect(accountantMenuItem("settings", "store")?.label).toBe("ข้อมูลร้านค้า/บริษัท");
    expect(isAccountantMenuVisible("settings.store", { "main.settings": false })).toBe(false);
  });
  it("denies eight operational Settings even with IT opt-in", () => {
    const denied: Array<[string, string]> = [
      ["settings.inet_nops", "inet-nops"], ["settings.notifications", "notifications"],
      ["settings.display", "display"], ["settings.order_kitchen", "order-kitchen"],
      ["settings.table_qr", "table-qr"], ["settings.activity", "activity"],
      ["settings.devices", "devices"], ["settings.branches", "branches"]
    ];
    for (const [key, slug] of denied) {
      expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain(key);
      expect(accountantMenuItem("settings", slug)).toBeNull();
      expect(isAccountantMenuVisible(key, { [key]: true })).toBe(false);
    }
  });
});
