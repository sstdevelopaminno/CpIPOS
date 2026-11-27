import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(new URL("../../src/" + path, import.meta.url), "utf8");
describe("CUSTOM grocery module authorization stays aligned between UI and API", () => {
  it("both server and snapshot use the same decision and preserve explicit feature rows", () => {
    const gate = read("lib/feature-gate.ts");
    const snapshot = read("app/api/pos/features/route.ts");
    expect(gate).toContain("!enabled && !planFeatureRow && !tenantOverride && !branchOverride");
    expect(gate).toContain("hasCustomGroceryModuleGrant({ ...decision, featureCode })");
    expect(snapshot).toContain("if (hasCustomGroceryModuleGrant");
    expect(snapshot).toContain("packageFeatures.has(feature) || tenantOverrides.has(feature) || branchOverrides.has(feature)");
    expect(gate).toContain('eq("tenant_id", tenantId)');
    expect(gate).toContain("contractAllowsAccess(contract)");
  });
  it("retains server permission checks on each requested page and the API feature guard", () => {
    for (const page of ["sales-list", "sales-summary", "product-sales", "receipts", "stock"]) {
      expect(read("app/preview/pos/" + page + "/page.tsx")).toContain("assertPosMenuPageAllowed");
      expect(read("app/preview/pos/" + page + "/page.tsx")).toContain("requirePosPagePermission");
    }
    const api = read("lib/pos-api-feature-guard.ts");
    expect(api).toContain("requireTenantFeature");
    expect(read("app/api/pos/sales-list/route.ts")).toContain('requirePosApiFeature(auth, "advanced_sales_reports")');
  });
});

describe("CUSTOM grocery settings integration", () => {
  it("exposes scoped notification preferences without granting the QR ordering feature", () => {
    const gate = read("lib/feature-gate.ts");
    const snapshot = read("app/api/pos/features/route.ts");
    const route = read("app/api/pos/settings/notifications/route.ts");
    const settings = read("components/pos-preview/pos-settings-workspace.tsx");
    expect(gate).toContain('":settings-only"');
    expect(gate).toContain('hasCustomGroceryNotificationSettingsGrant(decision)');
    expect(snapshot).toContain("features.grocery_notification_settings = hasCustomGroceryNotificationSettingsGrant");
    expect(settings).toContain("enabledFeatures?.grocery_notification_settings === true");
    expect(route).toContain("requirePosNotificationSettingsFeature");
    expect(route).toContain("requestedBranchId !== auth.branchId");
    expect(route).toContain('requiredPermission: "settings:view"');
    expect(route).toContain('auth.branchRole !== "owner" && auth.branchRole !== "manager"');
  });
});
