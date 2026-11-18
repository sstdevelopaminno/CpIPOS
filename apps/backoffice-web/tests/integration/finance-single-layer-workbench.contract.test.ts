import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const main = read("src/components/finance/finance-sales-dashboard.tsx");
const sales = read("src/components/finance/finance-sales-records-table.tsx");
const receipts = read("src/components/finance/finance-document-workspace.tsx");
const menu = read("src/app/finance/[group]/[slug]/page.tsx");
const modulePage = read("src/app/finance/[module]/page.tsx");
const packagePage = read("src/app/finance/package-payment/page.tsx");
const header = read("src/app/finance/finance-section-header.tsx");
const owner = read("src/app/preview/pos/finance/page.tsx");

describe("Finance ERP single-layer full-bleed workspace for all menu surfaces", () => {
  it("renders one flat dashboard surface, not nested rounded cards", () => {
    expect(main).toContain('finance-program-workbench w-full min-w-0 bg-white text-slate-900');
    expect(main).toContain('className="w-full min-w-0 border-b border-slate-200 bg-white"');
    expect(main).toContain('data-finance-report-inset className="w-full min-w-0 divide-y divide-slate-200 bg-white"');
    expect(main).toContain('className="grid min-w-0 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0"');
    expect(main).toContain('className="min-w-0 bg-white"');
    expect(main).not.toContain('rounded-lg border border-slate-200 bg-white shadow-sm');
    expect(main).not.toContain('gap-3 lg:grid-cols-2');
    expect(main).toContain('className="bg-[#f3f6fa] px-5 py-4 text-xs leading-5 text-slate-600"');
  });

  it("keeps content text 16-20px inside the flush outer borders", () => {
    expect(main).toContain('bg-[#edf3fa] px-4 py-3 sm:px-5');
    expect(main).toContain('className="px-4 py-4 sm:px-5 sm:py-5"');
    expect(main).toContain('className="flex flex-wrap items-center justify-between gap-3 bg-[#f3f6fa] px-5 py-3');
    expect(main).toContain('bg-[#f1f5fb] px-5 py-3');
    expect(sales).toContain('className="w-full min-w-0 bg-white"');
    expect(sales).toContain('bg-[#f3f6fa] px-5 py-4');
    expect(sales).toContain('min-w-[1240px] border-collapse text-left text-[13px] leading-5');
    expect(sales).toContain('px-4 py-3');
    expect(owner).toContain('overflow-y-auto bg-white text-slate-900');
    expect(owner).not.toContain('bg-slate-50 p-2');
  });

  it("applies the same single-layer structure to receipts, modules, settings and package screens", () => {
    expect(receipts).toContain('finance-documents-workbench w-full min-w-0 bg-white');
    expect(receipts).toContain('gap-x-4 gap-y-4 border-b border-slate-200 bg-white px-5 py-4');
    expect(receipts).toContain('className="w-full min-w-0 border-b border-slate-200 bg-white"');
    expect(receipts).toContain('className="whitespace-nowrap px-4 py-3"');
    expect(receipts).not.toContain('rounded-lg border border-slate-200 bg-white shadow-sm');
    expect(menu).toContain('finance-secondary-workbench w-full min-w-0 bg-white text-slate-900');
    expect(menu).toContain('w-full min-w-0 divide-y divide-slate-200 bg-white');
    expect(modulePage).toContain('finance-secondary-workbench w-full min-w-0 bg-white text-slate-900');
    expect(modulePage).toContain('className="min-w-0 bg-white px-5 py-4"');
    expect(menu).toContain('const cell = "border-b border-slate-100 px-4 py-3 text-left text-xs leading-5"');
    expect(packagePage).toContain('className="border-b border-slate-200 bg-white px-5 py-5"');
    expect(header).toContain('bg-[#155c94] px-5 py-3 text-white');
  });

  it("does not change finance entitlements, monetary calculation or receipt/tax document actions", () => {
    expect(owner).toContain("requirePosSession()");
    expect(owner).toContain('hasFinancePackageAccess(scope.session.tenant_id)');
    expect(menu).toContain('requireAccountantPage(item.key)');
    expect(main).toContain('FinanceSalesRecordsTable table={report.table}');
    expect(receipts).toContain('onClick={() => { void openBill(row.orderId); }}');
    expect(receipts).toContain('FinanceConfirmDialog');
    expect(main).not.toMatch(/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
  });
});
