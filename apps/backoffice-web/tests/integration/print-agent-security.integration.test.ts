import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { acknowledgePrintJob, claimPrintJobs, createPrintAgent, requirePrintAgent } from "@/lib/printing/print-agent-service";

const mocks = vi.hoisted(() => ({
  appendAuditLog: vi.fn(),
  getSupabaseServiceClient: vi.fn()
}));

vi.mock("@/lib/audit-log", () => ({
  appendAuditLog: mocks.appendAuditLog
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));

function hashAgentKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
    mocks.getSupabaseServiceClient.mockReturnValue({ from: vi.fn(() => ({ insert })) });

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
        id: "agent-1",
        tenant_id: "t1",
        branch_id: "b1",
        device_id: null,
        device_code: "POS-01",
        agent_name: "Counter Agent",
        api_key_hash: hashAgentKey(agentKey),
        status: "inactive",
        last_seen_at: null,
        last_claim_at: null,
        app_version: null,
        metadata: {}
      },
      error: null
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocks.getSupabaseServiceClient.mockReturnValue({ from: vi.fn(() => ({ select })) });

    await expect(
      requirePrintAgent(
        new Request("http://localhost/api/print-agent/v1/heartbeat", {
          method: "POST",
          headers: { "x-print-agent-key": agentKey }
        })
      )
    ).rejects.toThrow("agent_inactive");
  });

  it("does not let one agent acknowledge another agent's claimed job", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "job-1",
        tenant_id: "t1",
        branch_id: "b1",
        status: "printing",
        metadata: {},
        claimed_by_agent_id: "agent-2"
      },
      error: null
    }));
    const currentQuery: Record<string, unknown> = {
      eq: vi.fn(() => currentQuery),
      maybeSingle
    };
    const select = vi.fn(() => currentQuery);
    mocks.getSupabaseServiceClient.mockReturnValue({ from: vi.fn(() => ({ select })) });

    await expect(
      acknowledgePrintJob(
        {
          id: "agent-1",
          tenant_id: "t1",
          branch_id: "b1",
          device_id: null,
          device_code: "POS-01",
          agent_name: "Counter Agent",
          api_key_hash: "hash",
          status: "active",
          last_seen_at: null,
          last_claim_at: null,
          app_version: null,
          metadata: {}
        },
        "job-1",
        {}
      )
    ).rejects.toThrow("print_job_not_claimed_by_agent");
  });

  it("does not return a job when a concurrent claim wins first", async () => {
    const candidateJob = {
      id: "job-1",
      tenant_id: "t1",
      branch_id: "b1",
      order_id: null,
      printer_id: "printer-1",
      printer_role: "receipt",
      connection_type: "NETWORK_ESC_POS",
      status: "pending",
      payload_text: "receipt",
      payload_json: {},
      retry_count: 0,
      max_retry_count: 3,
      last_error: null,
      metadata: {},
      created_at: "2026-07-29T00:00:00.000Z",
      claimed_by_agent_id: null,
      claim_expires_at: null,
      printer_profiles: {
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
    };
    const selectJobsQuery: Record<string, unknown> = {
      eq: vi.fn(() => selectJobsQuery),
      in: vi.fn(() => selectJobsQuery),
      order: vi.fn(() => selectJobsQuery),
      limit: vi.fn(async () => ({ data: [candidateJob], error: null }))
    };
    const updateClaimQuery: Record<string, unknown> = {
      eq: vi.fn(() => updateClaimQuery),
      in: vi.fn(() => updateClaimQuery),
      select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) }))
    };
    const updateAgentQuery = { eq: vi.fn(async () => ({ data: null, error: null })) };
    const update = vi.fn((payload: Record<string, unknown>) => (payload.claimed_by_agent_id ? updateClaimQuery : updateAgentQuery));
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => selectJobsQuery),
      update: table === "print_jobs" ? update : vi.fn(() => updateAgentQuery)
    }));
    mocks.getSupabaseServiceClient.mockReturnValue({ from });

    const jobs = await claimPrintJobs(
      {
        id: "agent-1",
        tenant_id: "t1",
        branch_id: "b1",
        device_id: null,
        device_code: "POS-01",
        agent_name: "Counter Agent",
        api_key_hash: "hash",
        status: "active",
        last_seen_at: null,
        last_claim_at: null,
        app_version: null,
        metadata: {}
      },
      { limit: 1 }
    );

    expect(jobs).toEqual([]);
  });
});
