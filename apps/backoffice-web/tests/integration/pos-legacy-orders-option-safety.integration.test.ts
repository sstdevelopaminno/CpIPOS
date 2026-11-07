import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePosSession: vi.fn(),
  requireActiveShift: vi.fn(),
  requireTenantFeature: vi.fn(),
  resolveOrderPricing: vi.fn(),
  getSupabaseServiceClient: vi.fn(),
  appendAuditLog: vi.fn()
}));

vi.mock("@/lib/pos-session-guard", () => ({
  PosGuardError: class PosGuardError extends Error {
    constructor(public code: string, message: string, public status: number) {
      super(message);
    }
  },
  requirePosSession: mocks.requirePosSession,
  requirePermission: vi.fn(),
  requireActiveShift: mocks.requireActiveShift
}));
vi.mock("@/lib/feature-gate", () => ({
  FeatureGateError: class FeatureGateError extends Error {
    constructor(public code: string, message: string, public status: number) {
      super(message);
    }
  },
  requireTenantFeature: mocks.requireTenantFeature
}));
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseServiceClient: mocks.getSupabaseServiceClient }));
vi.mock("@/lib/services/pos-sales-mvp-service", () => ({ resolveOrderPricing: mocks.resolveOrderPricing }));
vi.mock("@/lib/audit-log", () => ({ appendAuditLog: mocks.appendAuditLog }));

describe("legacy POS /orders rejects ignored item selections", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.requirePosSession.mockResolvedValue({
      session: {
        tenant_id: "tenant-a",
        branch_id: "branch-a",
        user_id: "staff-a",
        role: "staff",
        device_code: "POS-01"
      }
    });
    mocks.requireActiveShift.mockResolvedValue({ shift: { id: "shift-a", status: "open" } });
    mocks.requireTenantFeature.mockResolvedValue(undefined);
    mocks.appendAuditLog.mockResolvedValue(undefined);
    mocks.getSupabaseServiceClient.mockReturnValue({ rpc: vi.fn() });
  });

  it.each([
    ["chosen modifiers", { native_selection: { modifier_option_ids: ["option-a"] } }],
    ["legacy modifier IDs", { modifier_option_ids: ["option-a"] }],
    ["empty modifier IDs", { modifier_option_ids: [] }],
    ["special price", { price_kind: "special", unit_price: 1 }],
    ["per-line notes", { notes: "no onions" }],
    ["explicit cart identity", { cart_line_id: "cart-item-a" }]
  ])("fails closed for %s before pricing or creating an order", async (_, extra) => {
    const { POST } = await import("@/app/api/pos/orders/route");
    const response = await POST(new Request("http://localhost/api/pos/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "test-request" },
      body: JSON.stringify({
        items: [{ product_id: "product-a", quantity: 1, ...extra }],
        discount_total: 0
      })
    }));
    const result = await response.json();
    expect(response.status).toBe(422);
    expect(result.error.code).toBe("order_line_customization_requires_sales_api");
    expect(mocks.resolveOrderPricing).not.toHaveBeenCalled();
    expect(mocks.getSupabaseServiceClient().rpc).not.toHaveBeenCalled();
  });
});
