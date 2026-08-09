import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { acknowledgePrintJob, claimPrintJobs, createPrintAgent, requirePrintAgent } from "@/lib/printing/print-agent-service";

const mocks = vi.hoisted(() => ({
  appendAuditLog: vi.fn(),
  getPrimarySupabaseServiceClient: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  getPrintExecutionDataPlaneClient: vi.fn()
}));

vi.mock("@/lib/audit-log", () => ({
  appendAuditLog: mocks.appendAuditLog
}));

vi.mock("@/lib/supabase-admin", () => ({
  getPrimarySupabaseServiceClient: mocks.getPrimarySupabaseServiceClient,
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));

vi.mock("@/lib/printing/print-execution-data-plane", () => ({
  getPrintExecutionDataPlaneClient: mocks.getPrintExecutionDataPlaneClient
}));

function hashAgentKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function activeAgent() {
  return {
    id: "agent-1",
    tenant_id: "t1",
    branch_id: "b1",
    device_id: null,
    device_code: "POS-01",
    agent_name: "Counter Agent",
    api_key_hash: "hash",
    status: "active" as const,
    last_seen_at: null,
    last_claim_at: null,
    app_version: null,
    metadata: {}
  };
}

describe("print agent security rules", () => {
  it("returns the agent secret once and stores only its hash", async () => {
    let inserted: Record<string, unknown> | null = null;
    const single = vi.fn(async () => ({
      data: {
        id: "agent-1",
        ...inserted,
        status: "active",
        last_seen_at: null,
        last_claim_at: null,
        created_at: "2026-07-29T00:00:00.000Z",
        updated_at: "2026-07-29T00:00:00.000Z"
      },
      error: null
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn((payload: Record<string, unknown>) => {
      inserted = payload;
      return { select };
    });
    mocks.getPrimarySupabaseServiceClient.mockReturnValue({ from: vi.fn(() => ({ insert })) });

    const result = await createPrintAgent(
      {
        userId: "u1",
        platformRole: "tenant_user",
        tenantId: "t1",
        branchId: "b1",
        branchRole: "manager"
      },
      { agent_name: "Counter Agent", device_code: "pos-01" }
    );

    expect(result.agent_key).toMatch(/^cpi_pa_/);
    expect(inserted?.api_key_hash).toBe(hashAgentKey(result.agent_key));
    expect(inserted?.api_key_hash).not.toBe(result.agent_key);
    expect(result.agent).not.toHaveProperty("api_key_hash");
  });

  it("blocks inactive agents before returning scoped identity", async () => {
    const agentKey = "cpi_pa_test";
    const maybeSingle = vi.fn(async () => ({
      data: {
        ...activeAgent(),
        api_key_hash: hashAgentKey(agentKey),
        status: "inactive"
      },
      error: null
    }));
    const query: Record<string, unknown> = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle
    };
    mocks.getPrimarySupabaseServiceClient.mockReturnValue({ from: vi.fn(() => query) });

    await expect(
      requirePrintAgent(
        new Request("http://localhost/api/print-agent/v1/heartbeat", {
          method: "POST",
          headers: { "x-print-agent-key": agentKey }
        })
      )
    ).rejects.toThrow("agent_inactive");
  });

  it("does not let stale or wrong attempts acknowledge a job", async () => {
    const executionClient = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "PRINT_JOB_ATTEMPT_STALE" } }))
    };
    mocks.getPrintExecutionDataPlaneClient.mockResolvedValue({ client: executionClient, home: "primary" });

    await expect(
      acknowledgePrintJob(activeAgent(), "job-1", {
        agent_attempt_id: "attempt-1",
        metadata: { provider: "test" }
      })
    ).rejects.toThrow("PRINT_JOB_ATTEMPT_STALE");
  });

  it("returns claimed jobs with the server-issued attempt id", async () => {
    const agent = activeAgent();
    const updateAgentQuery: Record<string, unknown> = {
      eq: vi.fn(() => updateAgentQuery),
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null })
    };
    mocks.getPrimarySupabaseServiceClient.mockReturnValue({
      from: vi.fn(() => ({ update: vi.fn(() => updateAgentQuery) }))
    });

    const printerQuery: Record<string, unknown> = {
      select: vi.fn(() => printerQuery),
      eq: vi.fn(() => printerQuery),
      then: (resolve: (value: unknown) => void) =>
        resolve({
          data: [
            {
              id: "printer-1",
              printer_name: "Receipt",
              printer_role: "receipt",
              connection_type: "NETWORK_ESC_POS",
              ip_address: "127.0.0.1",
              port: 9100,
              paper_width_mm: 58,
              enabled: true,
              metadata: {}
            }
          ],
          error: null
        })
    };
    const jobsQuery: Record<string, unknown> = {
      select: vi.fn(() => jobsQuery),
      eq: vi.fn(() => jobsQuery),
      in: vi.fn(async () => ({
        data: [
          {
            id: "job-1",
            tenant_id: "t1",
            branch_id: "b1",
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
            created_at: "2026-07-29T00:00:00.000Z",
            claimed_by_agent_id: "agent-1",
            claimed_at: "2026-07-29T00:00:00.000Z",
            claim_expires_at: "2026-07-29T00:01:00.000Z",
            agent_attempt_id: null,
            agent_error_code: null,
            printer_profiles: null
          }
        ],
        error: null
      }))
    };
    const executionClient = {
      from: vi.fn((table: string) => (table === "printer_profiles" ? printerQuery : jobsQuery)),
      rpc: vi.fn(async () => ({
        data: [{ job_id: "job-1", agent_attempt_id: "attempt-1" }],
        error: null
      }))
    };
    mocks.getPrintExecutionDataPlaneClient.mockResolvedValue({ client: executionClient, home: "primary" });

    const jobs = await claimPrintJobs(agent, { limit: 1 });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.agent_attempt_id).toBe("attempt-1");
  });
});