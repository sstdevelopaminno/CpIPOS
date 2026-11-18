import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const dashboard = source("src/components/finance/finance-sales-dashboard.tsx");
const records = source("src/components/finance/finance-sales-records-table.tsx");
const accountant = source("src/app/finance/page.tsx");
const owner = source("src/app/preview/pos/finance/page.tsx");

describe("CpiPOS Finance: text and content no longer touch panel borders", () => {
  it("retains edge-to-edge blue toolbar but gives brand, tabs and filters readable padding", () => {
    expect(dashboard).toContain('bg-[#155c94] px-4 pt-2 sm:px-5');
    expect(dashboard).toContain("rounded-t-md px-5 py-3 text-[13px] font-bold leading-5");
    expect(dashboard).toContain("border border-white/25 px-3 py-1.5 text-xs leading-5");
    expect(dashboard).toContain('bg-[#edf3fa] px-4 py-3 sm:px-5');
    expect(dashboard).toContain('className="px-4 py-4 sm:px-5 sm:py-5"');
    expect(dashboard).toContain("mt-1.5 h-10 w-full min-w-0 rounded-md");
    expect(dashboard).toContain('text-xs font-semibold leading-5 text-[#395878]');
  });

  it("insets every report including summary, charts, branch/method tables and notes", () => {
    const inset = dashboard.indexOf('data-finance-report-inset className="space-y-4 px-4 pb-5 sm:px-5"');
    const report = dashboard.indexOf('{report ? (', inset);
    const sales = dashboard.indexOf("<FinanceSalesRecordsTable table={report.table}", report);
    const notes = dashboard.indexOf("หมายเหตุทางบัญชี", report);
    expect(inset).toBeGreaterThan(0);
    expect(report).toBeGreaterThan(inset);
    expect(sales).toBeGreaterThan(report);
    expect(notes).toBeGreaterThan(sales);
    expect(dashboard).toContain("bg-[#f1f5fb] px-5 py-3");
    expect(dashboard).toContain('className="grid grid-cols-2 gap-4 p-5"');
    expect(dashboard).toContain('className="px-4 py-3 text-right tabular-nums"');
    expect(dashboard).toContain('className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs"');
  });

  it("pads every header and data cell in sales history and preserves horizontal scrolling", () => {
    expect(records).toContain('className="max-h-[560px] overflow-auto"');
    expect(records).toContain('min-w-[1240px] border-collapse text-left text-[13px] leading-5');
    expect(records).toContain('className="px-4 py-3 text-center"');
    expect(records).toContain('className="px-4 py-3 text-right');
    expect(records).toContain('rounded-md border px-3 py-1.5 text-xs');
    expect(records).not.toContain('px-3 py-2.5');
    expect(records).not.toContain('px-3 py-3');
    expect(records).toContain('bg-slate-50 px-5 py-4 text-xs');
  });

  it("keeps report shared by Owner/Accountant, with read-only data and unchanged API", () => {
    expect(accountant).toContain('<FinanceSalesDashboard actor="accountant" />');
    expect(owner).toContain('<FinanceSalesDashboard actor="owner" />');
    expect(dashboard).toContain('aria-label="หมวดการเงิน"');
    expect(dashboard).toContain('อ่านอย่างเดียว · READ ONLY');
    expect(dashboard).toContain('fetch("/api/finance/sales-overview?"');
    expect(dashboard).not.toMatch(/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
  });
});
