import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const load = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");
const helper = load("lib/server/optical-more-feature-access.ts");
const snapshot = load("app/api/pos/features/route.ts");
const menu = load("components/pos-preview/pos-more-workspace.tsx");
const routes: Array<[string,string,string]> = [
  ["sales-summary","more.sales_summary","reports:view"],
  ["receipts","more.receipts","receipts:view"],
  ["product-sales","more.product_sales","sales:list:view"]
];
describe("CUSTOM Optical IT-only More routes", () => {
  it("requires active CUSTOM Optical contract, IT command, and no explicit denial", () => {
    expect(helper).toContain("requireOpticalRetailEntitlement(tenantId)");
    expect(helper).toContain("isCustomPosMenuVisible(menuKey, policy, true)");
    expect(helper).toContain('eq("tenant_id", tenantId)');
    expect(helper).toContain('eq("feature_code", OPTICAL_MORE_FEATURES[menuKey].feature)');
    expect(helper).toContain("data?.some(row => row.is_enabled === false)");
    expect(helper).toContain("optical_feature_explicitly_denied");
  });
  it("applies authorization to BOTH page loads and API access without global feature grants", () => {
    for (const [route,key,permission] of routes) {
      const page = load(`app/preview/pos/${route}/page.tsx`);
      const api = load(`app/api/pos/${route}/route.ts`);
      expect(page).toContain(`authorizeOpticalMoreMenu(posMenuScope.session.tenant_id, posMenuScope.session.branch_id, "${key}")`);
      expect(page).toContain("requirePermission(");
      expect(page).toContain(`"${permission}"`);
      expect(api).toContain(`authorizeOpticalMoreMenu(auth.tenantId!, auth.branchId, "${key}")`);
      expect(api).toContain("requirePosApiFeature(auth,");
    }
    const reprint = load("app/api/pos/receipts/[orderId]/reprint/route.ts");
    expect(reprint).toContain('authorizeOpticalMoreMenu(auth.tenantId!, auth.branchId, "more.receipts")');
    expect(reprint).toContain("validateManagerPin");
    expect(reprint).toContain("appendAuditLog");
  });
  it("synchronizes just permitted Optical menu cards with validated backend grants", () => {
    expect(snapshot).toContain("const opticalMoreAccess = Object.fromEntries(");
    expect(snapshot).toContain("tenantOverrides.get(cfg.feature) !== false");
    expect(snapshot).toContain("branchOverrides.get(cfg.feature) !== false");
    expect(snapshot).toContain("isCustomPosMenuVisible(key, menuPolicy, true)");
    expect(menu).toContain("isCustom && opticalMoreAccess[href] === true && !isMenuLocked(href)");
    expect(menu).toContain('"/api/pos/features?refresh=1"');
    expect(menu).toContain("setPolicyReady(false); // Fail closed");
  });
});
