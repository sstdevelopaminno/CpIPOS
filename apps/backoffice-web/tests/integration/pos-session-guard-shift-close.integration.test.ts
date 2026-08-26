import { beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.fn();
const getSupabaseServiceClient = vi.fn();

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient }));

function makeQuery(result: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result)
  };
  return query;
}

describe("POS session guard shift close fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cookies.mockResolvedValue({
      get: (name: string) => (name === "pos_session_id" ? { value: "expired-session" } : undefined)
    });
  });

  it("keeps normal POS APIs locked while allowing shift close to use an expired session identity", async () => {
    const expiredSession = {
      id: "expired-session",
      tenant_id: "tenant-1",
      branch_id: "branch-1",
      user_id: "user-1",
      role: "manager",
      device_id: "device-1",
      device_code: "POS-1",
      shift_id: "shift-1",
      status: "expired",
      expires_at: "2026-01-01T00:00:00.000Z"
    };

    const from = vi.fn((table: string) => {
      if (table === "pos_sessions") return makeQuery({ data: expiredSession, error: null });
      if (table === "users_profiles") return makeQuery({ data: { id: "user-1", full_name: "Manager", is_active: true }, error: null });
      if (table === "user_branch_roles") return makeQuery({ data: { role: "owner" }, error: null });
      if (table === "branches") return makeQuery({ data: { id: "branch-1", name: "Branch", code: "B1" }, error: null });
      if (table === "tenants") return makeQuery({ data: { id: "tenant-1", name: "Tenant", code: "T1", is_active: true }, error: null });
      return makeQuery({ data: null, error: null });
    });
    getSupabaseServiceClient.mockReturnValue({ from });

    const { requirePosSession, requirePosSessionForShiftClose } = await import("@/lib/pos-session-guard");

    await expect(requirePosSession()).rejects.toMatchObject({ code: "session_not_active" });

    const shiftCloseScope = await requirePosSessionForShiftClose();
    expect(shiftCloseScope.session.id).toBe("expired-session");
    expect(shiftCloseScope.session.role).toBe("owner");
    expect(shiftCloseScope.permissions).toContain("users:manage");
    expect(shiftCloseScope.permissions).toContain("shift:close");
  });
});
