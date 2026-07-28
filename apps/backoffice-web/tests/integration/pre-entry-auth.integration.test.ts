import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServiceClient = vi.fn();

vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient }));

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

function makeQuery<T>(result: QueryResult<T>) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => query),
    returns: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: QueryResult<T>) => unknown) => Promise.resolve(resolve(result))
  };
  return query;
}

describe("pre-entry employee code lookup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not scan branch roles when indexed employee profile lookup is available but has no match", async () => {
    const profileCodeQuery = makeQuery({ data: [], error: null });
    const from = vi.fn((table: string) => {
      if (table === "pos_user_profiles") return profileCodeQuery;
      throw new Error(`Unexpected table lookup: ${table}`);
    });
    getSupabaseServiceClient.mockReturnValue({ from });

    const { resolveEmployeeByCode } = await import("@/lib/server/pre-entry-auth");
    const employee = await resolveEmployeeByCode({
      tenantId: "tenant-1",
      branchId: "branch-1",
      employeeCode: "999999"
    });

    expect(employee).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith("user_branch_roles");
  });

  it("keeps the legacy branch scan only when pos_user_profiles is missing", async () => {
    const missingProfileQuery = makeQuery({
      data: null,
      error: { code: "42P01", message: 'relation "pos_user_profiles" does not exist' }
    });
    const branchRolesQuery = makeQuery({
      data: [
        {
          user_id: "owner-user",
          role: "owner",
          users_profiles: {
            id: "owner-user",
            email: "owner@demo.local",
            full_name: "Demo Owner",
            is_active: true
          }
        }
      ],
      error: null
    });
    const from = vi.fn((table: string) => {
      if (table === "pos_user_profiles") return missingProfileQuery;
      if (table === "user_branch_roles") return branchRolesQuery;
      throw new Error(`Unexpected table lookup: ${table}`);
    });
    getSupabaseServiceClient.mockReturnValue({ from });

    const { resolveEmployeeByCode } = await import("@/lib/server/pre-entry-auth");
    const employee = await resolveEmployeeByCode({
      tenantId: "tenant-1",
      branchId: "branch-1",
      employeeCode: "182536"
    });

    expect(employee).toMatchObject({
      userId: "owner-user",
      role: "owner",
      employeeCode: "182536"
    });
    expect(from).toHaveBeenCalledWith("user_branch_roles");
  });
});
