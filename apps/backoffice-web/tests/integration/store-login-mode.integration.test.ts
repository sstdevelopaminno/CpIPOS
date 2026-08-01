import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServiceClient = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient }));

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

function makeQuery<T>(result: QueryResult<T>) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result)
  };
  return query;
}

describe("store login mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("resolves single-register mode from the active contract package", async () => {
    const contractQuery = makeQuery({
      data: {
        id: "contract-1",
        package_id: "package-solo",
        status: "active",
        ended_at: null,
        max_branches: null,
        max_devices: null,
        metadata: null
      },
      error: null
    });
    const packageQuery = makeQuery({
      data: {
        id: "package-solo",
        code: "solo",
        max_branches: 1,
        max_devices: 1,
        metadata: { login_mode: "single_register", branch_selection: "hidden", max_cashier_devices: 1 }
      },
      error: null
    });
    const from = vi.fn((table: string) => {
      if (table === "tenant_subscription_contracts") return contractQuery;
      if (table === "subscription_packages") return packageQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    getSupabaseServiceClient.mockReturnValue({ from });

    const { resolveStoreLoginMode, shouldSkipBranchSelection } = await import("@/lib/server/store-login-mode");
    const mode = await resolveStoreLoginMode("tenant-1");

    expect(mode).toMatchObject({ singleRegister: true, branchSelection: "hidden", maxBranches: 1, maxDevices: 1, packageCode: "solo" });
    expect(shouldSkipBranchSelection(mode, 1, false)).toBe(true);
    expect(shouldSkipBranchSelection(mode, 2, true)).toBe(false);
  });

  it("falls back to tenant package when there is no active contract", async () => {
    const contractQuery = makeQuery({ data: null, error: null });
    const tenantQuery = makeQuery({ data: { package_id: "package-starter" }, error: null });
    const packageQuery = makeQuery({
      data: {
        id: "package-starter",
        code: "starter",
        max_branches: 1,
        max_devices: 2,
        metadata: {}
      },
      error: null
    });
    const from = vi.fn((table: string) => {
      if (table === "tenant_subscription_contracts") return contractQuery;
      if (table === "tenants") return tenantQuery;
      if (table === "subscription_packages") return packageQuery;
      throw new Error(`Unexpected table: ${table}`);
    });
    getSupabaseServiceClient.mockReturnValue({ from });

    const { resolveStoreLoginMode, shouldSkipBranchSelection } = await import("@/lib/server/store-login-mode");
    const mode = await resolveStoreLoginMode("tenant-1");

    expect(mode).toMatchObject({ singleRegister: false, branchSelection: "visible", maxBranches: 1, maxDevices: 2, packageCode: "starter" });
    expect(shouldSkipBranchSelection(mode, 1, true)).toBe(true);
    expect(shouldSkipBranchSelection(mode, 1, false)).toBe(false);
  });
});
describe("pre-entry employee route recovers single-register branch context", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("keeps single-register branch recovery server-side only", async () => {
    const { shouldSkipBranchSelection } = await import("@/lib/server/store-login-mode");
    expect(
      shouldSkipBranchSelection(
        { singleRegister: true, branchSelection: "hidden", maxBranches: 1, maxDevices: 1, packageCode: "solo", source: "contract_package" },
        1,
        false
      )
    ).toBe(true);
    expect(
      shouldSkipBranchSelection(
        { singleRegister: true, branchSelection: "hidden", maxBranches: 1, maxDevices: 1, packageCode: "solo", source: "contract_package" },
        2,
        true
      )
    ).toBe(false);
  });
});