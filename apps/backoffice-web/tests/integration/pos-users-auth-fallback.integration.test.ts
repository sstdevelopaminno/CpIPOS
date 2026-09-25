import { beforeEach, describe, expect, it, vi } from "vitest";

class PosGuardError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PosGuardError";
    this.code = code;
    this.status = status;
  }
}

const getAuthContext = vi.fn();
const getPosApiAuthContext = vi.fn();
const getSupabaseServiceClient = vi.fn();
const validateManagerPin = vi.fn();
const appendAuditLog = vi.fn();
const requirePosApiFeature = vi.fn(async () => undefined);

vi.mock("@/lib/audit-log", () => ({ appendAuditLog }));
vi.mock("@/lib/auth-context", () => ({ getAuthContext }));
vi.mock("@/lib/pos-api-auth", () => ({ getPosApiAuthContext }));
vi.mock("@/lib/pos-session-guard", () => ({ PosGuardError }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient }));
vi.mock("@/lib/pin-approval", () => ({ validateManagerPin }));
vi.mock("@/lib/pos-api-feature-guard", () => ({
  featureGateFail: () => null,
  requirePosApiFeature
}));

type QueryResult<T> = {
  data: T;
  error: null;
};

type ChainableQuery<T> = {
  select: (columns?: string) => ChainableQuery<T>;
  eq: (column: string, value: unknown) => ChainableQuery<T>;
  in: (column: string, values: unknown[]) => ChainableQuery<T>;
  order: (column: string, options?: unknown) => ChainableQuery<T>;
  update: (values: unknown) => ChainableQuery<T>;
  upsert: (values: unknown, options?: unknown) => ChainableQuery<T>;
  maybeSingle: <TNext = T>() => Promise<QueryResult<TNext>>;
  single: <TNext = T>() => Promise<QueryResult<TNext>>;
  then: Promise<QueryResult<T>>["then"];
};

function createChainableQuery<T>(
  result: QueryResult<T>,
  options: {
    maybeSingleResult?: QueryResult<unknown>;
    singleResult?: QueryResult<unknown>;
  } = {}
): ChainableQuery<T> {
  const query = {} as ChainableQuery<T>;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.upsert = vi.fn(() => query);
  query.maybeSingle = vi.fn(() => Promise.resolve((options.maybeSingleResult ?? result) as QueryResult<unknown>));
  query.single = vi.fn(() => Promise.resolve((options.singleResult ?? result) as QueryResult<unknown>));
  const promise = Promise.resolve(result);
  query.then = promise.then.bind(promise);
  return query;
}

describe("POS users auth fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads POS users through branch auth context when POS session is missing", async () => {
    getPosApiAuthContext.mockRejectedValue(new PosGuardError("missing_pos_session", "POS session is required.", 401));
    getAuthContext.mockResolvedValue({
      userId: "owner-user",
      platformRole: "tenant_user",
      tenantId: "tenant-1",
      branchId: "branch-1",
      branchRole: "owner"
    });

    const branchQuery = createChainableQuery({
      data: [{ id: "branch-1", code: "BKK-01", name: "Branch 1", is_active: true }],
      error: null
    });
    const userQuery = createChainableQuery({
      data: [
        {
          id: "role-1",
          user_id: "staff-user",
          branch_id: "branch-1",
          role: "staff",
          is_default: false,
          users_profiles: {
            id: "staff-user",
            full_name: "Staff User",
            email: "staff@demo.local",
            is_active: true
          }
        }
      ],
      error: null
    });
    const deviceQuery = createChainableQuery({ data: [], error: null });
    const tenantQuery = createChainableQuery({ data: { primary_owner_user_id: "owner-user" }, error: null });
    const scopeQuery = createChainableQuery({ data: [], error: null });
    const profileSettingsQuery = createChainableQuery({ data: [], error: null });
    const from = vi.fn((tableName: string) => {
      if (tableName === "branches") return branchQuery;
      if (tableName === "tenants") return tenantQuery;
      if (tableName === "user_branch_roles") return userQuery;
      if (tableName === "branch_devices") return deviceQuery;
      if (tableName === "pos_user_device_scopes") return scopeQuery;
      if (tableName === "pos_user_profiles") return profileSettingsQuery;
      return createChainableQuery({ data: [], error: null });
    });
    getSupabaseServiceClient.mockReturnValue({ from });

    const { GET } = await import("@/app/api/pos/users/route");
    const response = await GET(new Request("http://localhost/api/pos/users"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.metadata.role).toBe("owner");
    expect(getAuthContext).toHaveBeenCalledWith({ requireBranchScope: true });
  });

  it("rejects a duplicate employee code before updating the user profile", async () => {
    getPosApiAuthContext.mockResolvedValue({
      userId: "owner-user",
      platformRole: "tenant_user",
      tenantId: "tenant-1",
      branchId: "branch-1",
      branchRole: "owner"
    });
    validateManagerPin.mockResolvedValue({ approved: true, approverUserId: "owner-user", approverRole: "owner" });

    const roleQuery = createChainableQuery(
      { data: [], error: null },
      { maybeSingleResult: { data: { role: "staff" }, error: null } }
    );
    const profileSettingsLoadQuery = createChainableQuery({ data: [], error: null });
    const duplicateCodeQuery = createChainableQuery(
      { data: [], error: null },
      { maybeSingleResult: { data: { user_id: "another-user" }, error: null } }
    );
    const profileLookupQuery = createChainableQuery(
      { data: [], error: null },
      { maybeSingleResult: { data: { email: "staff@demo.local" }, error: null } }
    );

    const posProfileQueries = [profileSettingsLoadQuery, duplicateCodeQuery];
    const tenantQuery = createChainableQuery({ data: { primary_owner_user_id: "owner-user" }, error: null });
    const from = vi.fn((tableName: string) => {
      if (tableName === "user_branch_roles") return roleQuery;
      if (tableName === "tenants") return tenantQuery;
      if (tableName === "users_profiles") return profileLookupQuery;
      if (tableName === "pos_user_profiles") return posProfileQueries.shift() ?? duplicateCodeQuery;
      return createChainableQuery({ data: [], error: null });
    });
    getSupabaseServiceClient.mockReturnValue({ from });

    const { PATCH } = await import("@/app/api/pos/users/route");
    const response = await PATCH(
      new Request("http://localhost/api/pos/users", {
        method: "PATCH",
        body: JSON.stringify({
          action: "update_profile",
          user_id: "staff-user",
          branch_id: "branch-1",
          full_name: "Staff Updated",
          email: "staff-updated@demo.local",
          employee_code: "182536",
          position_title: "Staff",
          permission_role: "staff",
          role: "staff",
          approval_pin: "1357"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("employee_code_duplicate");
    expect(profileLookupQuery.update).not.toHaveBeenCalled();
  });

  it("blocks a manager from assigning a PIN directly to staff", async () => {
    getPosApiAuthContext.mockResolvedValue({
      userId: "manager-user",
      platformRole: "tenant_user",
      tenantId: "tenant-1",
      branchId: "branch-1",
      branchRole: "manager"
    });

    const roleQuery = createChainableQuery(
      { data: [], error: null },
      { maybeSingleResult: { data: { role: "staff" }, error: null } }
    );
    getSupabaseServiceClient.mockReturnValue({
      from: vi.fn((tableName: string) => tableName === "tenants"
        ? createChainableQuery({ data: { primary_owner_user_id: "owner-user" }, error: null })
        : roleQuery)
    });

    const { PATCH } = await import("@/app/api/pos/users/route");
    const response = await PATCH(
      new Request("http://localhost/api/pos/users", {
        method: "PATCH",
        body: JSON.stringify({
          action: "set_pin",
          user_id: "staff-user",
          branch_id: "branch-1",
          pin: "1234",
          approval_pin: "2468"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden_target_role");
    expect(validateManagerPin).not.toHaveBeenCalled();
  });

  it("lets an owner grant staff cancel-bill PIN authority through the scoped RPC", async () => {
    getPosApiAuthContext.mockResolvedValue({
      userId: "owner-user",
      platformRole: "tenant_user",
      tenantId: "tenant-1",
      branchId: "branch-1",
      branchRole: "owner"
    });
    validateManagerPin.mockResolvedValue({
      approved: true,
      approverUserId: "owner-user",
      approverRole: "owner"
    });

    const roleQuery = createChainableQuery(
      { data: [], error: null },
      { maybeSingleResult: { data: { role: "staff" }, error: null } }
    );
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    getSupabaseServiceClient.mockReturnValue({
      from: vi.fn((tableName: string) => tableName === "tenants"
        ? createChainableQuery({ data: { primary_owner_user_id: "owner-user" }, error: null })
        : roleQuery),
      rpc
    });

    const { PATCH } = await import("@/app/api/pos/users/route");
    const response = await PATCH(
      new Request("http://localhost/api/pos/users", {
        method: "PATCH",
        body: JSON.stringify({
          action: "set_cancel_bill_approval",
          user_id: "staff-user",
          branch_id: "branch-1",
          is_enabled: true,
          pin: "7890",
          approval_pin: "1357"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.is_enabled).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "configure_staff_cancel_bill_approval",
      expect.objectContaining({
        p_tenant_id: "tenant-1",
        p_branch_id: "branch-1",
        p_user_id: "staff-user",
        p_is_enabled: true,
        p_granted_by: "owner-user",
        p_pin_hash: expect.any(String)
      })
    );
  });
});
