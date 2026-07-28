import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePosSession = vi.fn();
const updateCachedPosSessionShift = vi.fn();
const withPosSessionCookie = vi.fn((response: Response) => response);
const loadPosRuntimeDevicePolicyForSession = vi.fn(async () => ({
  name: "POS 1",
  status: "active",
  block_sales: false,
  reason_code: null
}));
const getSupabaseServiceClient = vi.fn();

class PosGuardError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

vi.mock("@/lib/pos-session-guard", () => ({
  PosGuardError,
  requirePosSession,
  updateCachedPosSessionShift,
  withPosSessionCookie
}));
vi.mock("@/lib/pos-device-status", () => ({ loadPosRuntimeDevicePolicyForSession }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient }));

function neverResolvingQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => new Promise<never>(() => undefined))
  };
  return query;
}

describe("POS session current API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    requirePosSession.mockResolvedValue({
      session: {
        id: "session-1",
        tenant_id: "tenant-1",
        branch_id: "branch-1",
        user_id: "user-1",
        role: "manager",
        device_id: "device-1",
        device_code: "POS-1",
        shift_id: "shift-1",
        status: "active",
        expires_at: "2026-07-27T12:00:00.000Z"
      },
      tenant: { code: "T1", name: "Tenant" },
      branch: { code: "B1", name: "Branch" },
      user: { full_name: "Manager" },
      permissions: ["pos.sales.access"]
    });
  });

  it("returns a degraded retry response when the bound shift lookup times out", async () => {
    vi.useFakeTimers();
    const shiftsQuery = neverResolvingQuery();
    getSupabaseServiceClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "shifts") return shiftsQuery;
        throw new Error(`Unexpected table lookup: ${table}`);
      })
    });

    const { GET } = await import("@/app/api/pos/session/current/route");
    const responsePromise = GET();
    await vi.advanceTimersByTimeAsync(3500);
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("shift_lookup_degraded");
    expect(response.headers.get("x-pos-session-shift-fallback")).toBe("1");
    expect(withPosSessionCookie).toHaveBeenCalledWith(response, "session-1");
  });
});
