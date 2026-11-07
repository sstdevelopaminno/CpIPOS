import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPosApiAuthContext: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  getRoutedSupabaseServiceClient: vi.fn(),
  appendAuditLog: vi.fn(),
  invalidatePosScopeRuntimeCaches: vi.fn(),
  dispatchOrderToKitchen: vi.fn()
}));
vi.mock("@/lib/pos-api-auth", () => ({ getPosApiAuthContext: mocks.getPosApiAuthContext }));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient: mocks.getSupabaseServiceClient }));
vi.mock("@/lib/tenant-data-router", () => ({ getRoutedSupabaseServiceClient: mocks.getRoutedSupabaseServiceClient }));
vi.mock("@/lib/audit-log", () => ({ appendAuditLog: mocks.appendAuditLog }));
vi.mock("@/lib/pos-cache-invalidation", () => ({ invalidatePosScopeRuntimeCaches: mocks.invalidatePosScopeRuntimeCaches }));
vi.mock("@/lib/services/kitchen-routing-service", () => ({ dispatchOrderToKitchen: mocks.dispatchOrderToKitchen }));

function query(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    limit: vi.fn(() => q),
    update: vi.fn(() => q),
    maybeSingle: vi.fn(async () => result),
    then: (ok: (value: unknown) => unknown, fail?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(ok, fail)
  };
  return q;
}

const orderId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const pinId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

describe("interim POS cancel stock safety gate", () => {
  let from: ReturnType<typeof vi.fn>;
  let stockLedger: ReturnType<typeof query>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getPosApiAuthContext.mockResolvedValue({
      tenantId: "tenant-a", branchId: "branch-a",
      userId: "employee-a", branchRole: "manager", platformRole: "staff"
    });
    mocks.appendAuditLog.mockResolvedValue(undefined);
    stockLedger = query({ data: null, error: null, count: 2 });
    const approval = query({ data: {
      id: pinId, expires_at: new Date(Date.now() + 60000).toISOString()
    }, error: null });
    const order = query({ data: {
      id: orderId, order_no: "FG001", status: "cancelled", table_id: null
    }, error: null });
    from = vi.fn((table: string) => {
      if (table === "manager_pin_approvals") return approval;
      if (table === "stock_movements") return stockLedger;
      if (table === "orders") return order;
      throw new Error("unexpected table " + table);
    });
    mocks.getSupabaseServiceClient.mockReturnValue({ from });
    mocks.getRoutedSupabaseServiceClient.mockReturnValue({
      from: vi.fn(() => query({ data: null, error: null }))
    });
  });

  async function requestCancel() {
    const { POST } = await import("@/app/api/pos/orders/[orderId]/cancel/route");
    return POST(new Request("http://localhost/api/pos/orders/" + orderId + "/cancel", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "customer cancelled", cancellation_approval_id: pinId })
    }), { params: Promise.resolve({ orderId }) });
  }

  it("refuses to cancel an order with stock deductions instead of leaving stock depleted", async () => {
    const response = await requestCancel();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("stock_safe_cancellation_required");
    expect(from).not.toHaveBeenCalledWith("orders");
    expect(mocks.dispatchOrderToKitchen).not.toHaveBeenCalled();
    expect(stockLedger.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(stockLedger.eq).toHaveBeenCalledWith("branch_id", "branch-a");
    expect(stockLedger.eq).toHaveBeenCalledWith("ref_id", orderId);
    expect(stockLedger.eq).toHaveBeenCalledWith("movement_type", "sale_deduction");
  });

  it("fails closed if stock ledger cannot be checked", async () => {
    stockLedger.then = ((ok: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, count: null, error: { message: "ledger down" } }).then(ok)) as typeof stockLedger.then;
    const response = await requestCancel();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("stock_cancel_precheck_failed");
    expect(from).not.toHaveBeenCalledWith("orders");
  });

  it("preserves the queued-only cancellation for orders without ingredient deductions", async () => {
    stockLedger.then = ((ok: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, count: 0, error: null }).then(ok)) as typeof stockLedger.then;
    const response = await requestCancel();
    expect(response.status).toBe(200);
    const orderIndex = from.mock.calls.findIndex(([table]) => table === "orders");
    expect(orderIndex).toBeGreaterThanOrEqual(0);
    const orderQuery = from.mock.results[orderIndex]?.value;
    expect(orderQuery?.eq).toHaveBeenCalledWith("status", "queued");
  });
});
