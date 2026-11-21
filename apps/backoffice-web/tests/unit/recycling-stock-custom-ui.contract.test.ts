import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");
const workspace = read("src/components/pos/recycling-stock-workspace.tsx");
const route = read("src/app/preview/pos/stock/page.tsx");
const recyclingRoute = read("src/app/preview/pos/recycling/stock/page.tsx");
const catalogApi = read("src/app/api/pos/recycling/catalog/route.ts");
const css = read("src/app/globals.css");

describe("CUSTOM Recycling material management in the native POS shell", () => {
  it("keeps standard stock and authorized CUSTOM Recycling on their own server routes", () => {
    expect(route).toContain('redirect("/preview/pos/recycling/stock")');
    expect(recyclingRoute).toContain('assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/stock")');
    expect(recyclingRoute).toContain('requirePosPagePermission("inventory:view")');
    expect(recyclingRoute).toContain("isAuthorizedRecyclingTenant(tenantId)");
    expect(recyclingRoute).toContain("getRecyclingStockBranches(scope)");
    expect(recyclingRoute).toContain("requireRecyclingStockBranch");
    expect(recyclingRoute).toContain("requireTenantFeature");
  });

  it("renders material management as one full-width, scrollable native POS program", () => {
    expect(workspace).toContain('data-testid="recycling-custom-stock"');
    expect(workspace).toContain("recycling-stock-layout flex h-full min-h-0 w-full flex-col overflow-hidden");
    expect(workspace).toContain('data-testid="recycling-stock-toolbar"');
    expect(workspace).not.toContain('data-testid="recycling-stock-inline-summary"');
    expect(workspace).toContain('data-testid="recycling-stock-table-scroll"');
    expect(css).toContain(".pos-app-content-area:has(> .recycling-stock-layout)");
    expect(css).toContain("padding: 0 !important");
    expect(css).toContain("max-width: none");
    expect(workspace).not.toContain('max-w-[1500px]');
  });

  it("provides clear back navigation and an accessible, scrollable add/edit dialog", () => {
    expect(workspace).toContain('href="/preview/pos/more"');
    expect(workspace).not.toContain('href="/preview/pos/recycling"');
    expect(workspace).not.toContain('href="/preview/pos/recycling/accounting"');
    expect(workspace).toContain('data-testid="recycling-stock-branch-selector"');
    expect(workspace).toContain('data-testid="recycling-stock-editor-branch"');
    expect(workspace).toContain('data-testid="recycling-material-editor"');
    expect(workspace).toContain('aria-modal="true"');
    expect(workspace).toContain('aria-describedby="material-editor-description"');
    expect(workspace).toContain('event.key === "Escape"');
    expect(workspace).toContain('← กลับ');
    expect(workspace).toContain("max-h-[92vh]");
    expect(workspace).toContain("overflow-y-auto");
  });

  it("separates buy/sell prices without changing actual stock balances", () => {
    expect(workspace).toContain("ราคารับซื้อเข้าร้าน");
    expect(workspace).toContain('<option value="g"');
    expect(workspace).toContain('<option value="khid"');
    expect(workspace).toContain("parseRecyclingUnitPrice");
    expect(catalogApi).toContain("recycling_price_unit: priceUnit");
    expect(workspace).toContain("ราคาขายออก");
    expect(workspace).toContain('setEditing(null)');
    expect(catalogApi).toContain('requirePosApiFeature({ tenantId, branchId }, "stock_management")');
    expect(catalogApi).toContain("requireRecyclingStockBranch(requestedBranchId, branches, true)");
    expect(catalogApi).toContain("branch_id?: unknown");
    expect(catalogApi).toContain('role !== "owner" && role !== "manager"');
    expect(catalogApi).toContain('metadata.business_mode !== "recycling"');
    expect(catalogApi).toContain('"price_basis_locked"');
    expect(catalogApi).not.toContain('155858');
  });
});


describe("Recycling branch permissions isolation regression", () => {
  const scope = read("src/lib/server/recycling-stock-branch-scope.ts");
  it("never grants target branch writes from a UI-only selector", () => {
    expect(scope).toContain('eq("tenant_id", tenantId)');
    expect(scope).toContain('eq("user_id", userId)');
    expect(scope).toContain('eq("is_active", true)');
    expect(scope).toContain('role === "owner"');
    expect(scope).toContain('roles.get(row.id)');
    expect(scope).toContain("recycling_stock_branch_forbidden");
    expect(catalogApi).toContain('.eq("branch_id", branchId)');
    expect(catalogApi).toContain("business_mode");
    expect(workspace).toContain("branch_id: editingBranchId");
  });
});
