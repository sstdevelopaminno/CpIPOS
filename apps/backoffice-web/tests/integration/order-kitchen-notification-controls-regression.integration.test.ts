import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(workspaceRoot, path), "utf8");

const settingsPage = read("apps/backoffice-web/src/app/preview/pos/settings/order-kitchen/page.tsx");
const activityRoute = read("apps/backoffice-web/src/app/api/pos/table-qr-activity/route.ts");
const policyService = read("apps/backoffice-web/src/lib/services/table-qr-automation-policy-service.ts");

describe("order and kitchen notification controls regression", () => {
  it("keeps the submenu inside Settings instead of redirecting users to Sales", () => {
    expect(settingsPage).toContain('requirePosPagePermission("settings:view", "/preview/pos/settings")');
    expect(settingsPage).not.toContain('requirePosPagePermission("tables:manage", "/preview/pos")');
  });

  it("suppresses only food-order popup events when the effective popup policy is off", () => {
    expect(activityRoute).toContain("loadTableQrAutomationPolicyForScope");
    expect(activityRoute).toContain("if (!foodOrderPopupEnabled) return false");
    expect(activityRoute).toContain('row.event_type === "order"');
    expect(activityRoute).toContain('["call_staff", "request_checkout"]');
  });

  it("does not add another browser polling loop and caches the policy lookup", () => {
    expect(activityRoute).toContain("readThroughRuntimeCache<boolean>");
    expect(activityRoute).toContain("ttlMs: 15_000");
    expect(activityRoute).not.toContain("setInterval");
  });

  it("invalidates the popup policy cache after store or IT changes", () => {
    expect(policyService).toContain("invalidateRuntimeCacheByPrefix");
    expect(policyService).toContain("invalidatePopupPolicyCache(tenantId, branchId)");
    expect(policyService.match(/invalidatePopupPolicyCache\(tenantId, branchId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
