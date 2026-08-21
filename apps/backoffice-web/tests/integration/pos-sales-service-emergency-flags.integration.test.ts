import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supabase: undefined as undefined | ReturnType<typeof createSupabaseMock>,
  appendAuditLog: vi.fn(async () => undefined),
  appendPosDeadLetter: vi.fn()
}));

vi.mock("@/lib/audit-log", () => ({
  appendAuditLog: mocks.appendAuditLog
}));

vi.mock("@/lib/pos-resilience", () => ({
  appendPosDeadLetter: mocks.appendPosDeadLetter,
  POS_TIMEOUT_POLICY: {
    orderCreateMs: 1000,
    paymentCompleteMs: 1000
  },
  PosTimeoutError: class PosTimeoutError extends Error {
    code = "timeout";
    timeoutMs = 1000;
  },
  withTimeout: async <T>(promise: Promise<T>) => promise
}));

vi.mock("@/lib/services/table-service", () => ({
  attachOrderToTableSession: vi.fn(async () => undefined)
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: () => {
    if (!mocks.supabase) throw new Error("Supabase mock not initialized.");
    return mocks.supabase;
  }
}));

const flagNames = [
  "POS_FORCE_DIRECT_CREATE_NON_DELIVERY",
  "POS_FORCE_DIRECT_PAYMENT_COMPLETE",
  "POS_SOFT_BYPASS_INSUFFICIENT_STOCK"
] as const;

const originalFlags = Object.fromEntries(flagNames.map((name) => [name, process.env[name]]));

const auth = {
  userId: "00000000-0000-0000-0000-000000000103",
  platformRole: "tenant_user" as const,
  tenantId: "00000000-0000-0000-0000-000000000001",
  branchId: "00000000-0000-0000-0000-000000000011",
  branchRole: "staff" as const
};

const baseOrderInput = {
  shift_id: "00000000-0000-0000-0000-000000000201",
  order_type: "takeaway" as const,
  channel: "storefront",
  app_total_amount: 10,
  items: [
    {
      product_id: "00000000-0000-0000-0000-000000001001",
      quantity: 1,
      unit_price: 10
    }
  ]
};

function createSupabaseMock() {
  const calls: Array<{ kind: string; table?: string; fn?: string; payload?: unknown }> = [];

  const rpc = vi.fn(async (fn: string) => {
    calls.push({ kind: "rpc", fn });
    if (fn === "next_pos_order_no") return { data: "TKO-TEST-001", error: null };
    return { data: null, error: null };
  });

  const from = vi.fn((table: string) => createQueryMock(table, calls));

  return { rpc, from, calls };
}

function createQueryMock(table: string, calls: Array<{ kind: string; table?: string; fn?: string; payload?: unknown }>) {
  let selectedColumns = "";

  const query: Record<string, unknown> = {
    select: vi.fn((columns: string) => {
      selectedColumns = String(columns ?? "");
      calls.push({ kind: "select", table });
      return query;
    }),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    maybeSingle: vi.fn(async () => resolveMaybeSingle(table, selectedColumns)),
    single: vi.fn(async () => resolveMaybeSingle(table, selectedColumns)),
    insert: vi.fn(async (payload: unknown) => {
      calls.push({ kind: "insert", table, payload });
      return { error: null };
    }),
    update: vi.fn((payload: unknown) => {
      calls.push({ kind: "update", table, payload });
      return query;
    }),
    delete: vi.fn(() => {
      calls.push({ kind: "delete", table });
      return query;
    }),
    gt: vi.fn(() => query),
    gte: vi.fn(async () => ({ error: null })),
    neq: vi.fn(async () => ({ error: null })),
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolveQueryResult(table)).then(onFulfilled, onRejected)
  };

  return query;
}

function resolveMaybeSingle(table: string, selectedColumns: string) {
  if (table === "shifts") return { data: { id: baseOrderInput.shift_id, status: "open" }, error: null };
  if (table === "orders" && selectedColumns.includes("total_amount")) {
    return { data: { id: "order-1", total_amount: 10, status: "queued" }, error: null };
  }
  if (table === "orders" && selectedColumns.includes("order_type")) {
    return { data: { id: "order-1", order_type: "takeaway" }, error: null };
  }
  return { data: null, error: null };
}

function resolveQueryResult(table: string) {
  if (table === "products") {
    return { data: [{ id: baseOrderInput.items[0].product_id, price: 10, is_active: true }], error: null };
  }
  if (table === "payments") return { data: [], error: null };
  if (table === "stock_movements") return { data: [], error: null, count: 0 };
  if (table === "order_items") return { data: [], error: null };
  return { data: [], error: null };
}

function setFlags(values: Partial<Record<(typeof flagNames)[number], string | undefined>>) {
  for (const name of flagNames) {
    const value = values[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

async function loadService(values: Partial<Record<(typeof flagNames)[number], string | undefined>> = {}) {
  vi.resetModules();
  setFlags(values);
  mocks.supabase = createSupabaseMock();
  const service = await import("@/lib/services/pos-sales-service");
  return { service, supabase: mocks.supabase };
}

function hasInsert(supabase: ReturnType<typeof createSupabaseMock>, table: string) {
  return supabase.calls.some((call) => call.kind === "insert" && call.table === table);
}

afterEach(() => {
  for (const name of flagNames) {
    const original = originalFlags[name];
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
  mocks.supabase = undefined;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("POS sales emergency transaction flags", () => {
  it("keeps create, payment and insufficient-stock bypass disabled when env flags are undefined", async () => {
    const { service, supabase } = await loadService();
    const createRpc = vi.fn(async () => ({
      data: [{ order_id: "order-1", order_no: "TKO-TEST-001", order_status: "queued", created_at: "2026-08-08T00:00:00.000Z", duplicate_request: false }],
      error: null
    }));
    const paymentRpc = vi.fn(async () => ({
      data: [{ payment_group_id: "payment-group-1", total_paid: 10, order_status: "completed", duplicate_request: false }],
      error: null
    }));
    const stockRpc = vi.fn(async () => ({
      data: null,
      error: { message: "INSUFFICIENT_STOCK:ingredient-1" }
    }));

    const createResult = await service.executeCreatePosOrderTransaction({ auth, input: baseOrderInput, invokeRpc: createRpc });
    const paymentResult = await service.executeCompletePosPaymentTransaction({
      auth,
      input: { order_id: "order-1", payment_lines: [{ method: "cash", amount: 10 }] },
      invokeRpc: paymentRpc
    });
    const stockResult = await service.executeCreatePosOrderTransaction({ auth, input: baseOrderInput, invokeRpc: stockRpc });

    expect(createResult.ok).toBe(true);
    expect(paymentResult.ok).toBe(true);
    expect(stockResult.ok).toBe(false);
    if (!stockResult.ok) expect(stockResult.code).toBe("insufficient_stock");
    expect(createRpc).toHaveBeenCalledWith("create_pos_order_tx", expect.any(Object));
    expect(paymentRpc).toHaveBeenCalledWith("complete_pos_payment_tx", expect.any(Object));
    expect(hasInsert(supabase, "orders")).toBe(false);
  });

  it("maps financial invariant failures to a reviewable conflict instead of a server error", async () => {
    const { service } = await loadService();
    const paymentRpc = vi.fn(async () => ({
      data: null,
      error: { message: "ORDER_FINANCIAL_INVARIANT_VIOLATION:TOTAL_GRAND_MISMATCH" }
    }));

    const result = await service.executeCompletePosPaymentTransaction({
      auth,
      input: { order_id: "order-1", payment_lines: [{ method: "cash", amount: 10 }] },
      requestGroupId: "payment-group-1",
      invokeRpc: paymentRpc
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("payment_financial_review_required");
      expect(result.status).toBe(409);
    }
    expect(mocks.appendPosDeadLetter).toHaveBeenCalledWith(expect.objectContaining({ reason: "payment_financial_review_required" }));
  });
  it.each(["", "false", "0"])("keeps emergency behaviors disabled when env flags are %j", async (value) => {
    const { service, supabase } = await loadService({
      POS_FORCE_DIRECT_CREATE_NON_DELIVERY: value,
      POS_FORCE_DIRECT_PAYMENT_COMPLETE: value,
      POS_SOFT_BYPASS_INSUFFICIENT_STOCK: value
    });
    const createRpc = vi.fn(async () => ({
      data: [{ order_id: "order-1", order_no: "TKO-TEST-001", order_status: "queued", created_at: "2026-08-08T00:00:00.000Z", duplicate_request: false }],
      error: null
    }));
    const paymentRpc = vi.fn(async () => ({
      data: [{ payment_group_id: "payment-group-1", total_paid: 10, order_status: "completed", duplicate_request: false }],
      error: null
    }));
    const stockRpc = vi.fn(async () => ({
      data: null,
      error: { message: "INSUFFICIENT_STOCK:ingredient-1" }
    }));

    const createResult = await service.executeCreatePosOrderTransaction({ auth, input: baseOrderInput, invokeRpc: createRpc });
    const paymentResult = await service.executeCompletePosPaymentTransaction({
      auth,
      input: { order_id: "order-1", payment_lines: [{ method: "cash", amount: 10 }] },
      invokeRpc: paymentRpc
    });
    const stockResult = await service.executeCreatePosOrderTransaction({ auth, input: baseOrderInput, invokeRpc: stockRpc });

    expect(createResult.ok).toBe(true);
    expect(paymentResult.ok).toBe(true);
    expect(stockResult.ok).toBe(false);
    if (!stockResult.ok) expect(stockResult.code).toBe("insufficient_stock");
    expect(createRpc).toHaveBeenCalledWith("create_pos_order_tx", expect.any(Object));
    expect(paymentRpc).toHaveBeenCalledWith("complete_pos_payment_tx", expect.any(Object));
    expect(hasInsert(supabase, "orders")).toBe(false);
  });

  it.each(["true", "1", " TRUE "])("enables direct create and payment emergency paths when env flags are %j", async (value) => {
    const { service, supabase } = await loadService({
      POS_FORCE_DIRECT_CREATE_NON_DELIVERY: value,
      POS_FORCE_DIRECT_PAYMENT_COMPLETE: value,
      POS_SOFT_BYPASS_INSUFFICIENT_STOCK: "false"
    });
    const createRpc = vi.fn(async () => {
      throw new Error("create RPC should not be called");
    });
    const paymentRpc = vi.fn(async () => {
      throw new Error("payment RPC should not be called");
    });

    const createResult = await service.executeCreatePosOrderTransaction({ auth, input: baseOrderInput, invokeRpc: createRpc });
    const paymentResult = await service.executeCompletePosPaymentTransaction({
      auth,
      input: { order_id: "order-1", payment_lines: [{ method: "cash", amount: 10 }] },
      requestGroupId: "payment-group-1",
      invokeRpc: paymentRpc
    });

    expect(createResult.ok).toBe(true);
    expect(paymentResult.ok).toBe(true);
    expect(createRpc).not.toHaveBeenCalled();
    expect(paymentRpc).not.toHaveBeenCalled();
    expect(hasInsert(supabase, "orders")).toBe(true);
    expect(hasInsert(supabase, "payments")).toBe(true);
  });

  it.each(["true", "1", " TRUE "])("enables insufficient-stock soft bypass only when explicitly set to %j", async (value) => {
    const { service, supabase } = await loadService({
      POS_FORCE_DIRECT_CREATE_NON_DELIVERY: "false",
      POS_FORCE_DIRECT_PAYMENT_COMPLETE: "false",
      POS_SOFT_BYPASS_INSUFFICIENT_STOCK: value
    });
    const stockRpc = vi.fn(async () => ({
      data: null,
      error: { message: "INSUFFICIENT_STOCK:ingredient-1" }
    }));

    const result = await service.executeCreatePosOrderTransaction({ auth, input: baseOrderInput, invokeRpc: stockRpc });

    expect(result.ok).toBe(true);
    expect(stockRpc).toHaveBeenCalledWith("create_pos_order_tx", expect.any(Object));
    expect(hasInsert(supabase, "orders")).toBe(true);
  });

  it("does not use the non-delivery direct-create flag for delivery_manual orders", async () => {
    const { service, supabase } = await loadService({
      POS_FORCE_DIRECT_CREATE_NON_DELIVERY: "true",
      POS_FORCE_DIRECT_PAYMENT_COMPLETE: "false",
      POS_SOFT_BYPASS_INSUFFICIENT_STOCK: "false"
    });
    const createRpc = vi.fn(async () => ({
      data: [{ order_id: "order-1", order_no: "DLV-TEST-001", order_status: "queued", created_at: "2026-08-08T00:00:00.000Z", duplicate_request: false }],
      error: null
    }));

    const result = await service.executeCreatePosOrderTransaction({
      auth,
      input: { ...baseOrderInput, order_type: "delivery_manual" as const, channel: "grab", external_order_code: "G-001" },
      invokeRpc: createRpc
    });

    expect(result.ok).toBe(true);
    expect(createRpc).toHaveBeenCalledWith("create_pos_order_tx", expect.objectContaining({ p_order_type: "delivery_manual" }));
    expect(hasInsert(supabase, "orders")).toBe(false);
  });
});