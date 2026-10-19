import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
const read = (file: string) => readFileSync(resolve(process.cwd(), "src", file), "utf8");
const gate = read("lib/feature-gate.ts");
const features = read("app/api/pos/features/route.ts");
const userApi = read("app/api/pos/users/route.ts");
const branchService = read("lib/services/pos-settings-service.ts");
const branchApi = read("app/api/pos/settings/branches/route.ts");
describe("CUSTOM Optical users and branches settings rights", () => {
  it("unlocks only IT-approved management menus for an authorized CUSTOM Optical contract", () => {
    expect(gate).toContain('featureCode === "user_management" ? "settings.users"');
    expect(gate).toContain('featureCode === "branch_management" ? "settings.branches"');
    expect(gate).toContain('isOpticalRetailExplicitlyEnabled(contract?.metadata?.sales_modes)');
    expect(gate).toContain('command.data?.is_enabled === true');
    expect(gate).toContain('!tenantOverride && !branchOverride');
    expect(gate).toContain('toLowerCase() === "custom"');
    expect(features).toContain('menuPolicy[menu] === true && !tenantOverrides.has(feature) && !branchOverrides.has(feature)');
    expect(features).toContain('["user_management", "settings.users"]');
    expect(features).toContain('["branch_management", "settings.branches"]');
  });
  it("keeps quota checks before new user and branch creation, including reactivation", () => {
    expect(userApi).toContain('await enforceQuota(auth.tenantId!, "users")');
    expect(userApi.indexOf('await enforceQuota(auth.tenantId!, "users")'))
      .toBeLessThan(userApi.indexOf("auth.admin.createUser("));
    expect(branchService).toContain('await enforceQuota(auth.tenantId, "branches")');
    expect(branchService).toContain('!existing.data.is_active && input.is_active === true');
    expect(branchApi).toContain('requireOpticalBranchManagement(auth.tenantId!, auth.branchId)');
    expect(branchApi).toContain('requireTenantFeature(tenantId, "branch_management", branchId)');
  });
});
