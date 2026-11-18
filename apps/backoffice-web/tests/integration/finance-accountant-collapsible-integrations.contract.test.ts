import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const shell = source("src/app/finance/finance-accountant-shell.tsx");
const sidebar = source("src/app/finance/finance-sidebar-nav.tsx");
const logout = source("src/app/finance/finance-logout.tsx");
const layout = source("src/app/finance/layout.tsx");
const service = source("src/lib/server/finance-accountant-readonly-services.ts");
const page = source("src/app/finance/[group]/[slug]/page.tsx");
const packagePage = source("src/app/finance/package-payment/page.tsx");

describe("Accountant menu collapse, branding and read-only integration", () => {
  it("shows transparent logo, one Account department label, and persistent collapse", () => {
    expect(shell).toContain('src="/brand/cpipos-symbol-transparent.png"');
    expect(shell).not.toContain("cpipos-symbol-sidebar.png");
    expect(shell).not.toContain("ทุกสาขาในร้าน");
    expect(shell).toContain("ฝ่ายบัญชี");
    expect(shell).toContain("window.localStorage.getItem(STORAGE_KEY)");
    expect(shell).toContain("window.localStorage.setItem(STORAGE_KEY");
    expect(shell).toContain('aria-label={collapsed ? "ขยายแถบเมนูฝ่ายบัญชี" : "ยุบแถบเมนูฝ่ายบัญชี"}');
    expect(shell).toContain('"md:w-[76px]" : "md:w-[252px]"');
    expect(shell).toContain("onExpand={() => changeCollapsed(false)}");
  });

  it("retains nav links and exposes collapsed controls and footer logout accessibly", () => {
    expect(sidebar).toContain('title={collapsed ? "เพิ่มเติม" : undefined}');
    expect(sidebar).toContain('title={collapsed ? "ตั้งค่า" : undefined}');
    expect(sidebar).toContain("if (collapsed) { onExpand(); setMoreOpen(true); }");
    expect(sidebar).toContain("if (collapsed) { onExpand(); setSettingsOpen(true); }");
    expect(sidebar).toContain('href="/finance/package-payment"');
    expect(sidebar).toContain('href="/finance"');
    expect(sidebar).toContain('href={href}');
    expect(sidebar).not.toContain('settings.users');
    expect(shell).toContain('<FinanceLogout collapsed={collapsed} />');
    expect(logout).toContain('aria-label="ออกจากระบบ"');
    expect(logout).toContain('fetch("/api/auth/accounting/logout"');
    expect(layout).toContain('isAccountantMenuVisible(key, overrides)');
    expect(layout).toContain('requireFinanceSession()');
  });

  it("renders real read-only sales/receipts/catalog reports for accounting routes", () => {
    expect(page).toContain('requireAccountantPage(item.key)');
    expect(page).toContain('requireAccountantPage(item.key)');
    expect(page).toContain('<FinanceSectionHeader title={item.label}');
    expect(page).toContain('<FinanceSalesDashboard actor="accountant" initialTab="dashboard" />');
    expect(page).toContain('<FinanceDocumentWorkspace kind="receipt" />');
    expect(page).toContain('<FinanceDocumentWorkspace kind="tax" />');
    expect(page).toContain('loadAccountantProductCatalog(identity)');
    expect(page).toContain('loadAccountantProductSales(identity)');
    expect(page).toContain('loadAccountantStoreOverview(identity)');
    expect(page).toContain('import { FinanceDocumentWorkspace }');
    expect(page).toContain('taxView');
  });

  it("does not reuse POS cashier authentication or permit catalog/contract writes", () => {
    expect(service).toContain('import "server-only"');
    expect(service).toContain('.eq("tenant_id", identity.tenantId)');
    expect(service).toContain('.in("branch_id", branchIds)');
    expect(service).toContain('.eq("status", "completed")');
    expect(service).toContain('finance_product_sales_too_many_orders');
    expect(service).toContain('finance_catalog_too_large');
    expect(service).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(page).toContain('FinanceDocumentWorkspace kind="receipt"');
    expect(page).toContain('FinanceDocumentWorkspace kind="tax"');
    expect(packagePage).toContain('loadAccountantContractOverview(identity)');
    expect(packagePage).toContain('requireAccountantPage("main.package_payment")');
    expect(packagePage).toContain('หน้านี้ไม่ออกใบเสร็จ ไม่รับชำระ');
  });
});
