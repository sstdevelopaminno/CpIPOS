import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const resolverRoute = source("../../src/app/api/pos/buffet-products/resolve/route.ts");
const picker = source("../../src/components/pos/pos-buffet-price-picker-modal.tsx");
const salesModule = source("../../src/components/pos/pos-sales-module.tsx");

describe("POS buffet table branch-pricing continuation", () => {
  it("keeps buffet table as a first-class feature-gated sales mode", () => {
    expect(salesModule).toContain('"buffet_table"');
    expect(salesModule).toContain("PosBuffetTableModeButton");
    expect(salesModule).toContain("PosBuffetPricePickerModal");
    expect(resolverRoute).toContain('requireTenantFeature(scope.session.tenant_id, "table_management"');
    expect(resolverRoute).toContain('requirePermission(scope, "sales:enter")');
  });

  it("loads branch buffet product prices before the operator chooses a package", () => {
    expect(resolverRoute).toContain("export async function GET()");
    expect(resolverRoute).toContain('.from("products")');
    expect(resolverRoute).toContain('.select("id,name,price,is_active")');
    expect(resolverRoute).toContain("DEFAULT_BUFFET_PRICE_PLANS.map");
    expect(picker).toContain('method: "GET"');
    expect(picker).toContain("setRuntimePlans(body.data.plans)");
    expect(picker).toContain("กำลังโหลดราคาบุฟเฟ่ของสาขา");
  });

  it("never overwrites an existing branch product price from the POS picker", () => {
    expect(resolverRoute).not.toContain("update({ price: args.price");
    expect(resolverRoute).toContain("actualPrice = roundMoney(Number(existing.product.price ?? 0))");
    expect(resolverRoute).toContain('price_source: "branch_product"');
  });

  it("uses the server-resolved branch price when building the cart item", () => {
    expect(picker).toContain("const resolved = await resolveBuffetProduct(selectedPlan)");
    expect(picker).toContain("price: resolved.price");
    expect(picker).toContain("buildBuffetCartItem({ plan: effectivePlan, quantity, tableCode })");
    expect(picker).toContain("product_id: resolved.productId");
  });

  it("respects product activation state instead of silently reactivating a disabled buffet package", () => {
    expect(resolverRoute).toContain('if (existing.product.is_active === false)');
    expect(resolverRoute).toContain('fail("buffet_product_inactive"');
    expect(resolverRoute).toContain("product.is_active !== false && price > 0");
  });
});
