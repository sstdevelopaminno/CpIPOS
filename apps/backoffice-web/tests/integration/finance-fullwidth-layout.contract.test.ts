import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ownerPage = read("src/app/preview/pos/finance/page.tsx");
const accountantPage = read("src/app/finance/page.tsx");
const accountantLayout = read("src/app/finance/layout.tsx");
const workbench = read("src/components/finance/finance-sales-dashboard.tsx");

describe("Finance full-width workbench for Owner and Accountant", () => {
  it("removes the duplicate Owner title card but retains every authorization check", () => {
    expect(ownerPage).toContain('await requirePosSession()');
    expect(ownerPage).toContain('hasFinancePackageAccess(scope.session.tenant_id)');
    expect(ownerPage).toContain('overrides["main.finance"] === false');
    expect(ownerPage).toContain('<FinanceSalesDashboard actor="owner" />');
    expect(ownerPage).not.toContain("<header");
    expect(ownerPage).not.toContain("max-w-7xl");
    expect(ownerPage).not.toContain("mx-auto");
    expect(ownerPage).toContain('w-full min-w-0');
  });

  it("removes the duplicate Accountant title card and retains finance-only access", () => {
    expect(accountantPage).toContain('await requireAccountantPage("main.finance")');
    expect(accountantPage).toContain('<FinanceSalesDashboard actor="accountant" />');
    expect(accountantPage).not.toContain("<header");
    expect(accountantPage).not.toContain("max-w-7xl");
    expect(accountantPage).toContain('w-full min-w-0');
    expect(accountantLayout).toContain('min-w-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4');
  });

  it("lets single-currency totals span the available width without affecting financial operations", () => {
    expect(workbench).toContain('className="w-full min-w-0 space-y-3 text-slate-900"');
    expect(workbench).toContain('totals.length === 1 ? "grid grid-cols-1 gap-3"');
    expect(workbench).toContain('min-w-0 gap-3 lg:grid-cols-2');
    expect(workbench).toContain('aria-label="หมวดการเงิน"');
    expect(workbench).toContain('FinanceSalesRecordsTable');
    expect(workbench).toContain('อ่านอย่างเดียว · READ ONLY');
  });
});
