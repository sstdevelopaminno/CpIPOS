import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrimarySupabaseServiceClient: vi.fn(),
  getPrintExecutionDataPlaneClient: vi.fn()
}));

vi.mock("@/lib/supabase-admin", () => ({
  getPrimarySupabaseServiceClient: mocks.getPrimarySupabaseServiceClient
}));

vi.mock("@/lib/printing/print-execution-data-plane", () => ({
  getPrintExecutionDataPlaneClient: mocks.getPrintExecutionDataPlaneClient
}));

function activeAgent(id = "agent-claim-test") {
  return {
    id,
    tenant_id: "tenant-1",
    branch_id: "branch-1",
    device_code: "POS-01",
    app_version: null
  };
}

function printerQuery() {
  const query: Record<string, unknown> = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    abortSignal: vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: "printer-1",
            printer_name: "Receipt",
            printer_role: "receipt",
            connection_type: "NETWORK_ESC_POS",
            ip_address: null,
            port: null,
            paper_width_mm: 58,
            enabled: true,
            metadata: {}
          }
        ],
        error: null
      })
    )
  };
  return query;
}

function primaryUpdateClient() {
  const query: Record<string, unknown> = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    abortSignal: vi.fn(() => Promise.resolve({ data: null, error: null }))
  };
  return { from: vi.fn(() => query) };
}

describe("print agent claim bounded execution", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PRINT_AGENT_CLAIM_TIMEOUT_MS;
  });

  it("aborts a hung claim RPC and does not issue duplicate claim attempts", async () => {
    vi.useFakeTimers();
    process.env.PRINT_AGENT_CLAIM_TIMEOUT_MS = "1000";
    let rpcSignal: AbortSignal | undefined;
    const rpc = vi.fn(() => ({
      abortSignal: vi.fn((signal: AbortSignal) => {
        rpcSignal = signal;
        return new Promise(() => undefined);
      })
    }));
    const executionClient = {
      from: vi.fn(() => printerQuery()),
      rpc
    };
    mocks.getPrintExecutionDataPlaneClient.mockResolvedValue({ client: executionClient, home: "primary" });
    mocks.getPrimarySupabaseServiceClient.mockReturnValue(primaryUpdateClient());

    const { claimPrintJobsStabilized } = await import("@/lib/printing/print-agent-claim-stabilized");
    const claimPromise = claimPrintJobsStabilized(activeAgent("agent-timeout"), { limit: 1, lease_seconds: 45 });
    const rejection = expect(claimPromise).rejects.toThrow("print_agent_claim_timeout");

    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpcSignal?.aborted).toBe(true);
  });

  it("keeps the successful atomic claim path unchanged", async () => {
    const updateClient = primaryUpdateClient();
    mocks.getPrimarySupabaseServiceClient.mockReturnValue(updateClient);

    const jobsQuery: Record<string, unknown> = {
      select: vi.fn(() => jobsQuery),
      eq: vi.fn(() => jobsQuery),
      in: vi.fn(() => jobsQuery),
      abortSignal: vi.fn(() =>
        Promise.resolve({
          data: [
            {
              id: "job-1",
              tenant_id: "tenant-1",
              branch_id: "branch-1",
              order_id: null,
              printer_id: "printer-1",
              printer_role: "receipt",
              connection_type: "NETWORK_ESC_POS",
              status: "printing",
              payload_text: "receipt",
              payload_json: {},
              retry_count: 0,
              max_retry_count: 3,
              last_error: null,
              metadata: {},
              created_at: "2026-08-21T00:00:00.000Z",
              claimed_by_agent_id: "agent-success",
              claimed_at: "2026-08-21T00:00:00.000Z",
              claim_expires_at: "2026-08-21T00:01:00.000Z",
              agent_attempt_id: null,
              agent_error_code: null,
              printer_profiles: null
            }
          ],
          error: null
        })
      )
    };
    const rpc = vi.fn(() => ({
      abortSignal: vi.fn(() => Promise.resolve({ data: [{ job_id: "job-1", agent_attempt_id: "attempt-1" }], error: null }))
    }));
    const executionClient = {
      from: vi.fn((table: string) => (table === "printer_profiles" ? printerQuery() : jobsQuery)),
      rpc
    };
    mocks.getPrintExecutionDataPlaneClient.mockResolvedValue({ client: executionClient, home: "primary" });

    const { claimPrintJobsStabilized } = await import("@/lib/printing/print-agent-claim-stabilized");
    const jobs = await claimPrintJobsStabilized(activeAgent("agent-success"), { limit: 1, lease_seconds: 45 });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("job-1");
    expect(jobs[0]?.agent_attempt_id).toBe("attempt-1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(updateClient.from).toHaveBeenCalledWith("print_agents");
  });
});
