import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PosSalesPageDenied } from "../../src/lib/pos-sales-page-denial";
const source = (path: string) => readFileSync(new URL("../../src/" + path, import.meta.url), "utf8");
describe("Sales entry denial is explicit and fail-closed", () => {
  it("keeps login recovery, role/feature guards and unrelated 404 handling", () => {
    const guard = source("lib/pos-page-guard.ts");
    expect(guard).toContain('requirePermission(scope, permission)');
    expect(guard).toContain('requireTenantFeature(scope.session.tenant_id, feature, scope.session.branch_id)');
    expect(guard).toContain('error.status === 401');
    expect(guard).toContain('if (explainSalesDenial) throw new PosSalesPageDenied("feature")');
    expect(guard).toContain('notFound()');
    expect(guard).toContain('throw error');
    const menu = source("lib/server/pos-menu-policy-service.ts");
    expect(menu).toContain('!isCustomPosMenuVisible(menuKey, overrides, true)');
    expect(menu).toContain('if (explainSalesDenial) throw new PosSalesPageDenied("menu")');
    expect(menu).toContain('notFound()');
  });
  it("renders only the notice for a denied sales route, before either cashier is mounted", () => {
    for (const path of ["app/preview/pos/page.tsx", "app/preview/pos/general/page.tsx"]) {
      const page = source(path);
      expect(page).toContain('requirePosPagePermission("sale:create", "/login/store", true)');
      expect(page).toContain('assertPosMenuPageAllowed(');
      expect(page).toContain('if (error instanceof PosSalesPageDenied) return error');
      expect(page).toContain('throw error');
      expect(page).toContain('<PosSalesAccessNotice');
      expect(page.indexOf('<PosSalesAccessNotice')).toBeLessThan(page.indexOf(path.includes("/general/") ? '<PosLegacySalesContent' : '<RecyclingSalesContent'));
    }
    expect(new PosSalesPageDenied("feature").reason).toBe("feature");
  });
  it("requires explicit CUSTOM mode and both central branch features, not a redundant tenant row", () => {
    const service = source("lib/server/recycling-general-sale-entitlement.ts");
    expect(service).toContain('general_sale !== true');
    expect(service).toContain('pkg.data?.code !== "custom"');
    expect(service).toContain('lifecycle.data.access_locked');
    expect(service).toContain('hasBranchFeature(tenantId, branchId, "core_pos_sales")');
    expect(service).toContain('hasBranchFeature(tenantId, branchId, "barcode_scanner_mode")');
    expect(service).toContain('return cashier && scanner');
    expect(service).not.toContain('featureOverride.data?.is_enabled !== true');
    expect(source("components/pos/recycling-sales-content.tsx")).toContain('isAuthorizedCustomGeneralSaleTenant(tenantId,branchId)');
  });
});
