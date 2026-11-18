import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const layout = source("src/app/finance/layout.tsx");
const shell = source("src/app/finance/finance-accountant-shell.tsx");
const accountantPage = source("src/app/finance/page.tsx");
const sidebar = source("src/app/finance/finance-sidebar-nav.tsx");
const navIcon = source("src/app/finance/finance-nav-icon.tsx");
const logout = source("src/app/finance/finance-logout.tsx");
const dashboard = source("src/components/finance/finance-sales-dashboard.tsx");

describe("CpiPOS Accountant desktop Finance shell", () => {
  it("fills the top edge with one Finance workbench surface across menu pages", () => {
    expect(accountantPage).toContain('className="finance-office-workbench w-full min-w-0 text-slate-900"');
    expect(shell).toContain("has-[.finance-office-workbench]:p-0");
    expect(shell).toContain('min-w-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4');
    expect(dashboard).toContain('className="w-full min-w-0 border-b border-slate-200 bg-white"');
    expect(accountantPage).toContain('await requireAccountantPage("main.finance")');
    expect(accountantPage).toContain('<FinanceSalesDashboard actor="accountant" />');
  });

  it("shows the local CpiPOS brand and centers the finance account identity", () => {
    expect(shell).toContain('src="/brand/cpipos-symbol-transparent.png"');
    expect(shell).toContain('alt="โลโก้ CpiPOS"');
    expect(shell).toContain('text-center');
    expect(layout).toContain('requireFinanceSession()');
    expect(layout).toContain('getTenantPosMenuOverrides(identity.tenantId)');
  });

  it("keeps IT policy filtering for every accounting menu and does not add a user-settings menu", () => {
    expect(layout).toContain('isAccountantMenuVisible(key, overrides)');
    expect(layout).toContain('ACCOUNTANT_FINANCE_MENU.filter(item => visible(item.key))');
    expect(layout).toContain('ACCOUNTANT_SETTINGS_MENU.filter(item => visible(item.key))');
    for (const key of ['main.finance', 'main.settings', 'main.package_payment']) {
      expect(layout).toContain('visible("' + key + '")');
    }
    expect(sidebar).toContain('aria-label="เมนูฝ่ายบัญชี"');
    expect(sidebar).toContain('usePathname()');
    expect(sidebar).toContain('aria-current={pathname === "/finance" ? "page" : undefined}');
    expect(sidebar).toContain('aria-expanded={!collapsed && settingsOpen}');
    expect(sidebar).toContain('aria-expanded={financeOpen}');
    expect(sidebar).not.toContain('finance-more-menu');
    expect(sidebar).not.toContain("settings.users");
    expect(navIcon).toContain('stroke="currentColor"');
  });

  it("anchors the existing secure logout flow at the bottom of the sidebar", () => {
    expect(shell).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain');
    expect(shell).toContain('mt-auto shrink-0 border-t');
    expect(shell).toContain('<FinanceLogout collapsed={collapsed} />');
    expect(logout).toContain('fetch("/api/auth/accounting/logout"');
    expect(logout).toContain('method: "POST"');
    expect(logout).toContain('window.location.replace("/login/store")');
    expect(logout).toContain('<FinanceNavIcon name="logout" />');
    expect(logout).toContain('justify-center');
  });
});
