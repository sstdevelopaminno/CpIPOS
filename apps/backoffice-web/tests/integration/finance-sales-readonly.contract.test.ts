import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const auth = source("src/lib/server/finance-report-guard.ts");
const service = source("src/lib/server/finance-sales-report-service.ts");
const route = source("src/app/api/finance/sales-overview/route.ts");
const owner = source("src/app/preview/pos/finance/page.tsx");
const accountant = source("src/app/finance/page.tsx");

describe("Finance Dashboard read-only security contract", () => {
  it("requires distinct verified accountant or owner session and package/IT policies", () => {
    expect(auth).toContain('actor === "accountant"');
    expect(auth).toContain("await requireFinanceSession()");
    expect(auth).toContain('isAccountantMenuVisible("main.finance", overrides)');
    expect(auth).toContain("await requirePosSession()");
    expect(auth).toContain('toLowerCase() !== "owner"');
    expect(auth).toContain("await hasFinancePackageAccess(tenantId)");
    expect(auth).toContain('overrides["main.finance"] === false');
    expect(owner).toContain('overrides["main.finance"] === false');
    expect(owner).toContain('<FinanceSalesDashboard actor="owner" />');
    expect(accountant).toContain('requireAccountantPage("main.finance")');
    expect(accountant).toContain('<FinanceSalesDashboard actor="accountant" />');
  });
  it("never trusts tenant/user from the browser and fences each database read by tenant and branch", () => {
    expect(route).toContain('const actor = url.searchParams.get("actor")');
    expect(route).toContain('await requireFinanceReadScope(actor as FinanceReportActor)');
    expect(route).toContain('branchId: url.searchParams.get("branchId")');
    expect(service).toContain('.eq("tenant_id", scope.tenantId)');
    expect(service).toContain('.eq("is_active", true)');
    expect(service).toContain('new Set(scope.branchIds)');
    expect(service).toContain('finance_branch_not_permitted');
    expect(service).toContain('.in("branch_id", selectedBranchIds)');
    expect(service).toContain('.eq("status", "completed")');
    expect(service).toContain('.eq("status", "paid")');
    expect(service).toContain('finance_report_too_many_sales_narrow_dates');
    expect(route).toContain('"Cache-Control", "private, no-store');
  });
  it("uses only GET + SELECT queries, never edits source financial records", () => {
    expect(route).toContain("export async function GET(request: Request)");
    expect(route).not.toContain("export async function POST(");
    expect(route).not.toContain("export async function PATCH(");
    expect(route).not.toContain("export async function DELETE(");
    expect(service).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(service).toContain('readOnly: true');
    expect(service).toContain('basis: "payment_completed_at"');
  });
});
