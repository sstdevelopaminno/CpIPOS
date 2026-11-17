import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const dashboard = read("src/components/finance/finance-sales-dashboard.tsx");
const table = read("src/components/finance/finance-sales-records-table.tsx");
const service = read("src/lib/server/finance-sales-report-service.ts");
const api = read("src/app/api/finance/sales-overview/route.ts");
const analytics = read("src/lib/finance-sales-analytics.ts");

describe("ERP-like Finance workbench shared by Owner and Accountant", () => {
  it("provides a functional blue-tab workbench and controlled search filters", () => {
    for (const label of ["ภาพรวมการเงิน", "รายรับจากการขาย", "สรุปตามสาขา", "ช่องทางรับชำระ", "ตรวจสอบยอด"]) {
      expect(dashboard).toContain(label);
    }
    for (const label of ["เลขที่บิล", "จากวันที่", "ถึงวันที่", "ช่องทางรับชำระ", "สถานะตรวจสอบ", "รายการต่อหน้า"]) {
      expect(dashboard).toContain(label);
    }
    expect(dashboard).toContain('aria-label="หมวดการเงิน"');
    expect(dashboard).toContain('onSubmit={event => { event.preventDefault(); apply(); }}');
    expect(dashboard).toContain("setPage(1)");
    expect(dashboard).toContain("setReload(n => n + 1)");
    expect(dashboard).toContain("exportPage(report)");
  });

  it("paginates by the full server-authorized sales snapshot and separates summary totals", () => {
    expect(analytics).toContain("paginateFinanceSalesRecords(");
    expect(service).toContain("const { records, ...summary } = summarizeFinanceSales");
    expect(service).toContain("paginateFinanceSalesRecords(records, recordFilters)");
    expect(service).toContain("availableMethods");
    expect(api).toContain('billNo: url.searchParams.get("billNo")');
    expect(api).toContain('reconciliation: url.searchParams.get("reconciliation")');
    expect(api).toContain('pageSize: url.searchParams.get("pageSize")');
    expect(table).toContain("table.totalPages");
    expect(table).toContain("table.totalRows");
    expect(table).toContain("onPageChange(table.page + 1)");
    expect(table).toContain("row.billed - row.received");
  });

  it("exports only displayed page, protects CSV from spreadsheet formula injection, and has no financial writes", () => {
    expect(dashboard).toContain("report.table.rows");
    expect(dashboard).toContain('link.download = "cpipos-finance-"');
    expect(dashboard).toContain('const safe = /^[\\s]*[=+\\-@]/.test(text)');
    expect(dashboard).toContain('ส่งออก CSV (หน้านี้)');
    expect(service).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(api).toContain("export async function GET(");
    expect(api).not.toContain("export async function POST(");
  });
});
