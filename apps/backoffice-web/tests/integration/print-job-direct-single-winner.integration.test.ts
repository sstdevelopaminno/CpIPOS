import { beforeEach, describe, expect, it, vi } from "vitest";
import { processPrintJob } from "@/lib/printing/print-service";

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn(),
  networkPrint: vi.fn()
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));
vi.mock("@/lib/printing/adapters/network-escpos-adapter", () => ({
  NetworkEscPosAdapter: class {
    print = mocks.networkPrint;
  }
}));

function setupJob() {
  const profile = {
    id: "printer-A",
    tenant_id: "owner-A",
    branch_id: "branch-1",
    printer_name: "Counter",
    printer_role: "receipt",
    connection_type: "NETWORK_ESC_POS",
    ip_address: null,
    port: null,
    paper_width_mm: 80,
    enabled: true,
    metadata: {}
  };
  const row = {
    id: "job-1",
    tenant_id: "owner-A",
    branch_id: "branch-1",
    printer_id: profile.id,
    printer_role: "receipt",
    connection_type: "NETWORK_ESC_POS",
    status: "pending",
    retry_count: 0,
    max_retry_count: 3,
    payload_text: "TEST RECEIPT",
    payload_json: {},
    metadata: {},
    printer_profiles: profile
  };

  const from = vi.fn((table: string) => {
    expect(table).toBe("print_jobs");
    return {
      select: () => {
        const query = {
          eq() { return query; },
          async maybeSingle() {
            return { data: { ...row, printer_profiles: { ...profile } }, error: null };
          }
        };
        return query;
      },
      update(patch: Record<string, unknown>) {
        const filters: Record<string, unknown> = {};
        const acceptedStatuses: string[] = [];
        const query = {
          eq(field: string, value: unknown) { filters[field] = value; return query; },
          in(field: string, values: string[]) {
            if (field === "status") acceptedStatuses.push(...values);
            return query;
          },
          select() { return query; },
          async maybeSingle() {
            if (
              filters.id !== row.id ||
              filters.tenant_id !== row.tenant_id ||
              filters.branch_id !== row.branch_id ||
              filters.retry_count !== row.retry_count ||
              !acceptedStatuses.includes(row.status)
            ) {
              return { data: null, error: null };
            }
            Object.assign(row, patch);
            return { data: { id: row.id }, error: null };
          },
          async single() {
            Object.assign(row, patch);
            return { data: { ...row }, error: null };
          }
        };
        return query;
      }
    };
  });
  mocks.getSupabaseServiceClient.mockReturnValue({ from });
  return { row, from };
}

describe("direct physical print single-winner concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.networkPrint.mockResolvedValue({ metadata: {}, bytesSent: 100, providerJobId: null });
  });

  it("allows only one physical print for 20 concurrent requests on the same job", async () => {
    const { row } = setupJob();
    const results = await Promise.all(Array.from({ length: 20 }, () => processPrintJob("job-1")));

    expect(mocks.networkPrint).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("printed");
    expect(results).toHaveLength(20);
  });

  it("never sends an already printed job to a printer", async () => {
    const { row } = setupJob();
    row.status = "printed";
    await processPrintJob("job-1");
    expect(mocks.networkPrint).not.toHaveBeenCalled();
  });

  it("rejects a printer whose branch differs from the job", async () => {
    const { row } = setupJob();
    row.printer_profiles.branch_id = "branch-2";
    await expect(processPrintJob("job-1")).rejects.toThrow("printer_scope_mismatch");
    expect(mocks.networkPrint).not.toHaveBeenCalled();
  });
});
