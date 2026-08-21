import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requirePosSession: vi.fn(),
  requirePermission: vi.fn(),
  requirePosApiFeature: vi.fn(),
  featureGateFail: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  requirePrintAgent: vi.fn(),
  agentAuthFail: vi.fn(),
  claimPrintJobsStabilized: vi.fn()
}));

class MockPosGuardError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PosGuardError";
    this.code = code;
    this.status = status;
  }
}

vi.mock("@/lib/pos-session-guard", () => ({
  PosGuardError: MockPosGuardError,
  requirePermission: mocks.requirePermission,
  requirePosSession: mocks.requirePosSession
}));

vi.mock("@/lib/pos-api-feature-guard", () => ({
  featureGateFail: mocks.featureGateFail,
  requirePosApiFeature: mocks.requirePosApiFeature
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));

vi.mock("@/lib/printing/print-agent-service", () => ({
  requirePrintAgent: mocks.requirePrintAgent,
  agentAuthFail: mocks.agentAuthFail
}));

vi.mock("@/lib/printing/print-agent-claim-stabilized", () => ({
  PRINT_AGENT_CLAIM_TIMEOUT_MS: 1000,
  claimPrintJobsStabilized: mocks.claimPrintJobsStabilized
}));

function hangingNativeStateClient(capture: { signal?: AbortSignal }) {
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    abortSignal: vi.fn((signal: AbortSignal) => {
      capture.signal = signal;
      return query;
    }),
    maybeSingle: vi.fn(() => new Promise(() => undefined))
  };
  return { from: vi.fn(() => query) };
}

describe("production timeout route bounds", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.POS_CUSTOMER_DISPLAY_NATIVE_TIMEOUT_MS;
  });

  it("terminates native Customer Display state when the downstream Supabase read hangs", async () => {
    vi.useFakeTimers();
    process.env.POS_CUSTOMER_DISPLAY_NATIVE_TIMEOUT_MS = "500";
    const capture: { signal?: AbortSignal } = {};
    mocks.requirePosSession.mockResolvedValue({
      session: {
        tenant_id: "tenant-1",
        branch_id: "branch-1",
        device_id: "device-1",
        device_code: "POS-01"
      }
    });
    mocks.requirePermission.mockReturnValue(undefined);
    mocks.requirePosApiFeature.mockResolvedValue(undefined);
    mocks.featureGateFail.mockReturnValue(null);
    mocks.getSupabaseServiceClient.mockReturnValue(hangingNativeStateClient(capture));

    const { GET } = await import("@/app/api/pos/customer-display/v2/native-state/route");
    const responsePromise = GET();

    await vi.advanceTimersByTimeAsync(500);
    const response = await responsePromise;
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(504);
    expect(body.error?.code).toBe("customer_display_v2_native_query_timeout");
    expect(capture.signal?.aborted).toBe(true);
  });

  it("terminates print-agent job claim before the platform timeout when claiming hangs", async () => {
    vi.useFakeTimers();
    let routeSignal: AbortSignal | undefined;
    mocks.requirePrintAgent.mockImplementation(async (_request: Request, options: { signal?: AbortSignal }) => {
      routeSignal = options.signal;
      return {
        id: "agent-1",
        tenant_id: "tenant-1",
        branch_id: "branch-1",
        device_code: "POS-01",
        app_version: null
      };
    });
    mocks.agentAuthFail.mockReturnValue(null);
    mocks.claimPrintJobsStabilized.mockImplementation(() => new Promise(() => undefined));

    const { POST } = await import("@/app/api/print-agent/v1/jobs/claim/route");
    const responsePromise = POST(
      new Request("http://localhost/api/print-agent/v1/jobs/claim", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test" },
        body: JSON.stringify({ limit: 1, lease_seconds: 45 })
      })
    );

    await vi.advanceTimersByTimeAsync(1000);
    const response = await responsePromise;
    const body = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(504);
    expect(body.error?.code).toBe("print_agent_claim_timeout");
    expect(routeSignal?.aborted).toBe(true);
    expect(mocks.claimPrintJobsStabilized).toHaveBeenCalledTimes(1);
  });
});
