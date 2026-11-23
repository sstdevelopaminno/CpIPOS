import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueuePrintJob } from "@/lib/printing/print-service";

const mocks = vi.hoisted(() => ({ getSupabaseServiceClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));

type Input = Parameters<typeof enqueuePrintJob>[0];

function auth(tenantId: string, branchId: string): Input["auth"] {
  return {
    userId: "employee-1",
    platformRole: "tenant_user",
    tenantId,
    branchId,
    branchRole: "manager"
  };
}

function printer(tenantId: string, branchId: string, id = "receipt-1"): Input["printer"] {
  return {
    id,
    tenant_id: tenantId,
    branch_id: branchId,
    printer_name: id,
    printer_role: "receipt",
    connection_type: "NETWORK_ESC_POS",
    ip_address: null,
    port: null,
    paper_width_mm: 80,
    enabled: true,
    metadata: {},
    created_at: "2026-11-24T00:00:00.000Z",
    updated_at: "2026-11-24T00:00:00.000Z"
  };
}

function setupUniqueQueue() {
  const rows = new Map<string, Record<string, unknown>>();
  const keyOf = (record: Record<string, unknown>) =>
    [record.tenant_id, record.branch_id, record.idempotency_key].join("/");

  const from = vi.fn((table: string) => {
    expect(table).toBe("print_jobs");
    return {
      insert: (payload: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const key = keyOf(payload);
            // Emulates the unique (tenant_id,branch_id,idempotency_key) DB index.
            if (rows.has(key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
            const row = { id: "job-" + (rows.size + 1), ...payload, printed_at: null, failed_at: null };
            rows.set(key, row);
            return { data: row, error: null };
          }
        })
      }),
      select: () => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq(name: string, value: unknown) { filters[name] = value; return query; },
          async maybeSingle() {
            const row = rows.get(keyOf(filters));
            return { data: row ?? null, error: null };
          }
        };
        return query;
      }
    };
  });
  mocks.getSupabaseServiceClient.mockReturnValue({ from });
  return { rows, from };
}

function payload(tenantId: string, branchId: string, printerId = "receipt-1", orderId = "sale-1"): Input {
  return {
    auth: auth(tenantId, branchId),
    printer: printer(tenantId, branchId, printerId),
    orderId,
    printerRole: "receipt",
    payloadText: "receipt",
    idempotencyKey: "sale-1:receipt"
  };
}

describe("multi-owner multi-branch print queue isolation and concurrency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects printers from a different owner or branch before any database write", async () => {
    const { from } = setupUniqueQueue();
    const wrongOwner = payload("owner-A", "branch-1");
    wrongOwner.printer = printer("owner-B", "branch-1");
    const wrongBranch = payload("owner-A", "branch-1");
    wrongBranch.printer = printer("owner-A", "branch-2");
    await expect(enqueuePrintJob(wrongOwner)).rejects.toThrow("printer_scope_mismatch");
    await expect(enqueuePrintJob(wrongBranch)).rejects.toThrow("printer_scope_mismatch");
    expect(from).not.toHaveBeenCalled();
  });

  it("handles simultaneous requests independently across two owners and four branches", async () => {
    const { rows, from } = setupUniqueQueue();
    const scopes = [
      ["owner-A", "branch-1"],
      ["owner-A", "branch-2"],
      ["owner-B", "branch-1"],
      ["owner-B", "branch-2"]
    ] as const;
    const results = await Promise.all(
      scopes.flatMap(([tenant, branch]) =>
        Array.from({ length: 8 }, () => enqueuePrintJob(payload(tenant, branch)))
      )
    );

    expect(from).toHaveBeenCalled();
    expect(rows.size).toBe(4);
    for (let scope = 0; scope < scopes.length; scope += 1) {
      const claimed = results.slice(scope * 8, scope * 8 + 8);
      expect(new Set(claimed.map((job) => job.id)).size).toBe(1);
      expect(claimed.every((job) =>
        job.tenant_id === scopes[scope][0] && job.branch_id === scopes[scope][1]
      )).toBe(true);
    }
  });

  it("fails closed when the same scoped idempotency key targets another printer or bill", async () => {
    const { rows } = setupUniqueQueue();
    const original = payload("owner-A", "branch-1");
    await enqueuePrintJob(original);
    await expect(enqueuePrintJob(payload("owner-A", "branch-1", "receipt-2"))).rejects.toThrow(
      "print_idempotency_key_conflict"
    );
    await expect(enqueuePrintJob(payload("owner-A", "branch-1", "receipt-1", "sale-2"))).rejects.toThrow(
      "print_idempotency_key_conflict"
    );
    expect(rows.size).toBe(1);
  });
});
