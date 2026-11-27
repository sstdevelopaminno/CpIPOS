import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, hasBranchFeature } = vi.hoisted(() => ({
  from: vi.fn(),
  hasBranchFeature: vi.fn()
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: () => ({ from })
}));
vi.mock("@/lib/feature-gate", () => ({ hasBranchFeature }));

import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";

const future = "2099-01-01T00:00:00Z";
const past = "2000-01-01T00:00:00Z";
function fixture(overrides: Record<string, unknown> = {}) {
  const rows: Record<string, unknown> = {
    tenant_subscription_contracts: { package_id: "package", status: "active", ended_at: future, metadata: { sales_modes: { general_sale: true } } },
    subscription_packages: { code: "custom" },
    tenant_data_lifecycle: { access_locked: false, lifecycle_status: "active", subscription_expires_at: future },
    tenants: { is_active: true },
    ...overrides
  };
  from.mockImplementation((table: string) => {
    if (!(table in rows)) throw new Error("Unexpected table: " + table);
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: rows[table], error: null }))
    };
    return query;
  });
}

describe("CUSTOM grocery: active contract and branch-scoped shared feature checks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixture();
    hasBranchFeature.mockResolvedValue(true);
  });
  it("accepts an IT-approved active CUSTOM grocery mode without a redundant tenant override row", async () => {
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "branch")).resolves.toBe(true);
    expect(hasBranchFeature).toHaveBeenCalledWith("tenant", "branch", "core_pos_sales");
    expect(hasBranchFeature).toHaveBeenCalledWith("tenant", "branch", "barcode_scanner_mode");
    expect(from).not.toHaveBeenCalledWith("tenant_feature_subscriptions");
  });
  it.each(["core_pos_sales", "barcode_scanner_mode"])("denies when shared branch policy rejects %s", async (denied) => {
    hasBranchFeature.mockImplementation(async (_tenant, _branch, feature) => feature !== denied);
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "branch")).resolves.toBe(false);
  });
  it("never authorizes a recycling-only or missing-mode contract even if both feature checks would pass", async () => {
    fixture({ tenant_subscription_contracts: { package_id: "package", status: "active", ended_at: future, metadata: { sales_modes: { recycling: true } } } });
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "branch")).resolves.toBe(false);
    expect(hasBranchFeature).not.toHaveBeenCalled();
  });
  it("rejects fixed packages on the dedicated CUSTOM route", async () => {
    fixture({ subscription_packages: { code: "growth" } });
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "branch")).resolves.toBe(false);
  });
  it("rejects locked or expired subscriptions without granting access", async () => {
    fixture({ tenant_data_lifecycle: { access_locked: true, lifecycle_status: "active", subscription_expires_at: future } });
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "branch")).resolves.toBe(false);
    fixture({ tenant_subscription_contracts: { package_id: "package", status: "trial", ended_at: past, metadata: { sales_modes: { general_sale: true } } } });
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "branch")).resolves.toBe(false);
    expect(hasBranchFeature).not.toHaveBeenCalled();
  });
  it("rejects missing branch scope and propagates a central lookup outage rather than granting", async () => {
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "")).resolves.toBe(false);
    hasBranchFeature.mockRejectedValue(new Error("lookup unavailable"));
    await expect(isAuthorizedCustomGeneralSaleTenant("tenant", "branch")).rejects.toThrow("lookup unavailable");
  });
});
