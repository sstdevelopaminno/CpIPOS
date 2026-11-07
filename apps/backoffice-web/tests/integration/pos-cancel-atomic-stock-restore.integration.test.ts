import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  getPosApiAuthContext: vi.fn(),
  appendAuditLog: vi.fn(),
  invalidatePosScopeRuntimeCaches: vi.fn(),
  dispatchOrderToKitchen: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  getRoutedSupabaseServiceClient: vi.fn()
}));

vi.mock("@/lib/pos-api-auth", () => ({ getPosApiAuthContext: mocks.getPosApiAuthContext }));
vi.mock("@/lib/audit-log", () => ({ appendAuditLog: mocks.appendAuditLog }));
vi.mock("@/lib/pos-cache-invalidation", () => ({
  invalidatePosScopeRuntimeCaches: mocks.invalidatePosScopeRuntimeCaches
}));
vi.mock("@/lib/services/kitchen-routing-service", () => ({
  dispatchOrderToKitchen: mocks.dispatchOrderToKitchen
}));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient: mocks.getSupabaseServiceClient }));
vi.mock("@/lib/tenant-data-router", () => ({
  getRoutedSupabaseServiceClient: mocks.getRoutedSupabaseServiceClient
}));

function selectRows(row: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: row, error: null }))
  };
  return builder;
}

const orderId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const approvalId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const cancel = (reason = "cancel duplicate") =>
  new Request("http://localhost/api/pos/orders/" + orderId + "/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason, cancellation_approval_id: approvalId })
  });
const params = { params: Promise.resolve({ orderId }) };

describe("POS cancel bill must reverse stock atomically", () => {
  let rpc: ReturnType<typeof vi.fn>;
  let dbFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getPosApiAuthContext.mockResolvedValue({
      tenantId: "tenant-a",
      branchId: "branch-a",
      userId: "employee-a",
      branchRole: "manager",
      platformRole: "staff"
    });
    mocks.appendAuditLog.mockResolvedValue(undefined);
    mocks.dispatchOrderToKitchen.mockResolvedValue({ ok: true, queuedPrintJobCount: 1 });
    dbFrom = vi.fn((table: string) => {
      if (table === "manager_pin_approvals") {
        return selectRows({ id: approvalId, expires_at: new Date(Date.now() + 60_000).toISOString() });
      }
      throw new Error("Unexpected direct database table: " + table);
    });
    rpc = vi.fn(async () => ({
      data: [{
        id: orderId,
        order_no: "FG001",
        status: "cancelled",
        cancelled_reason: "cancel duplicate",
        updated_at: new Date().toISOString(),
        table_id: null,
        restored_ingredient_count: 2,
        restored_quantity: 350,
        table_session_closed_count: 0,
        table_released: false
      }],
      error: null
    }));
    mocks.getSupabaseServiceClient.mockReturnValue({ from: dbFrom, rpc });
    mocks.getRoutedSupabaseServiceClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== "kitchen_tickets") throw new Error("Unexpected kitchen table");
        return selectRows(null);
      })
    });
  });

  it("reverses stock with queued-only scoped RPC and never writes order status directly", async () => {
    const { POST } = await import("@/app/api/pos/orders/[orderId]/cancel/route");
    const response = await POST(cancel(), params);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.restored_ingredient_count).toBe(2);
    expect(payload.data.restored_quantity).toBe(350);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "cancel_queued_pos_order_and_restore_stock_tx",
      expect.objectContaining({
        p_tenant_id: "tenant-a",
        p_branch_id: "branch-a",
        p_order_id: orderId,
        p_actor_user_id: "employee-a",
        p_approval_id: approvalId
      })
    );
    expect(dbFrom).not.toHaveBeenCalledWith("orders");
    expect(dbFrom).not.toHaveBeenCalledWith("stock_movements");
    expect(dbFrom).not.toHaveBeenCalledWith("ingredients");
  });

  it.each([
    ["ORDER_NOT_QUEUED", 409, "order_not_cancelable"],
    ["CANCELLATION_APPROVAL_INVALID", 403, "cancellation_approval_invalid"],
    ["ORDER_NOT_FOUND", 404, "order_not_found"],
    ["database temporarily unavailable", 503, "cancel_order_failed"]
  ])("leaves the bill untouched when atomic RPC fails: %s", async (errorMessage, status, code) => {
    rpc.mockResolvedValue({ data: null, error: { message: errorMessage } });
    const { POST } = await import("@/app/api/pos/orders/[orderId]/cancel/route");
    const response = await POST(cancel(), params);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(mocks.dispatchOrderToKitchen).not.toHaveBeenCalled();
    expect(mocks.invalidatePosScopeRuntimeCaches).not.toHaveBeenCalled();
  });

  it("does not call the atomic RPC with expired PIN approval", async () => {
    dbFrom.mockImplementation(() => selectRows({
      id: approvalId, expires_at: new Date(Date.now() - 60_000).toISOString()
    }));
    const { POST } = await import("@/app/api/pos/orders/[orderId]/cancel/route");
    const response = await POST(cancel(), params);
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not release a newer table session through a separate API write", async () => {
    rpc.mockResolvedValue({
      data: [{
        id: orderId, status: "cancelled", table_id: "table-a",
        restored_ingredient_count: 1, restored_quantity: 100,
        table_session_closed_count: 1, table_released: false
      }],
      error: null
    });
    const { POST } = await import("@/app/api/pos/orders/[orderId]/cancel/route");
    const response = await POST(cancel(), params);
    expect(response.status).toBe(200);
    expect(dbFrom).not.toHaveBeenCalledWith("table_bill_sessions");
    expect(dbFrom).not.toHaveBeenCalledWith("dining_tables");
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "table_bill_cancelled",
      metadata: expect.objectContaining({ table_released: false })
    }));
  });

  it("has a database-side queued precondition, branch-scoped approval, and service-role-only grants", () => {
    const migration = readFileSync(new URL("../../../../supabase/migrations/20261107173000_atomic_queued_pos_cancel_restore_stock.sql", import.meta.url), "utf8");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("v_order.status::text <> 'queued'");
    expect(migration).toContain("a.target_id = p_order_id");
    expect(migration).toContain("a.branch_id = p_branch_id");
    expect(migration).toContain("a.consumed_at IS NULL");
    expect(migration).toContain("app.void_order_and_restore_stock_tx(");
    expect(migration).toContain("s.order_id = p_order_id");
    expect(migration).toContain("NOT EXISTS (");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("TO service_role;");
  });
});
