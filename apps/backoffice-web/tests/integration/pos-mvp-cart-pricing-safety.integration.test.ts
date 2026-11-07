import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn()
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));

import {
  resolveOrderPricing,
  type SalesMvpCartItemInput
} from "../../src/lib/services/pos-sales-mvp-service";

function scopedCatalog(products: Array<{
  id: string; name: string; price: number; is_active: boolean
}>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(async () => ({ data: products, error: null }))
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn(() => query);
  mocks.getSupabaseServiceClient.mockReturnValue({ from });
  return { from, query };
}

const price = (
  items: SalesMvpCartItemInput[],
  discountTotal?: unknown
) => resolveOrderPricing({
  tenantId: "tenant-a",
  branchId: "branch-a",
  items,
  discountTotal
});

describe("server-authoritative POS sale / stock line consistency", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["missing product among valid lines", [
      { product_id: "product-a", quantity: 1 },
      { product_id: "", quantity: 1 }
    ]],
    ["fractional quantity", [{ product_id: "product-a", quantity: 1.5 }]],
    ["unsafe integer", [{ product_id: "product-a", quantity: Number.MAX_SAFE_INTEGER + 1 }]],
    ["negative quantity", [{ product_id: "product-a", quantity: -1 }]],
    ["not-a-number quantity", [{ product_id: "product-a", quantity: Number.NaN }]]
  ])("rejects %s without querying inventory or creating a partial sale", async (_, items) => {
    const { from } = scopedCatalog([{ id: "product-a", name: "Tea", price: 20, is_active: true }]);
    const result = await price(items);
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(result.ok ? "" : result.status).toBe(422);
  });

  it("rejects invalid cart envelopes before looking up products", async () => {
    const { from } = scopedCatalog([]);
    expect((await price([])).ok).toBe(false);
    expect((await price(null as unknown as SalesMvpCartItemInput[])).ok).toBe(false);
    expect((await price(Array.from({ length: 501 }, () => ({
      product_id: "product-a", quantity: 1
    })))).ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "bad"])(
    "rejects invalid discount %s before touching inventory",
    async (discountTotal) => {
      const { from } = scopedCatalog([]);
      const result = await price([{ product_id: "product-a", quantity: 1 }], discountTotal);
      expect(result).toMatchObject({ ok: false, code: "invalid_discount", status: 422 });
      expect(from).not.toHaveBeenCalled();
    }
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not sell products with invalid canonical price %s",
    async (invalidPrice) => {
      scopedCatalog([{ id: "product-a", name: "Tea", price: invalidPrice, is_active: true }]);
      const result = await price([{ product_id: "product-a", quantity: 1 }]);
      expect(result).toMatchObject({ ok: false, code: "invalid_product_price", status: 409 });
    }
  );

  it("calculates entire validated cart with consistent two-decimal totals", async () => {
    const { query } = scopedCatalog([
      { id: "product-a", name: "Tea", price: 19.95, is_active: true },
      { id: "product-b", name: "Rice", price: 50.1, is_active: true }
    ]);
    const result = await price([
      { product_id: "product-a", quantity: 3 },
      { product_id: "product-b", quantity: 2 }
    ], 5.1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pricedItems.map(x => x.line_total)).toEqual([59.85, 100.2]);
    expect(result.totals).toEqual({
      subtotal: 160.05,
      discount_total: 5.1,
      tax_total: 0,
      grand_total: 154.95
    });
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(query.eq).toHaveBeenCalledWith("branch_id", "branch-a");
  });

  it("caps a valid oversized discount at the cart subtotal without negative bill", async () => {
    scopedCatalog([{ id: "product-a", name: "Tea", price: 50, is_active: true }]);
    const result = await price([{ product_id: "product-a", quantity: 2 }], 250);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totals).toEqual({
      subtotal: 100, discount_total: 100, tax_total: 0, grand_total: 0
    });
  });
});
