import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCheckoutSubmitPayload } from "../../src/components/pos/features/checkout-flow";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("product special price end-to-end contract", () => {
  it("sends each cart line price independently to the sales API", () => {
    const payload = buildCheckoutSubmitPayload({
      idempotencyKey: "special-price-test",
      activeOrder: null,
      shiftId: "shift-1",
      orderType: "takeaway",
      subtotal: 90,
      summaryDiscount: 0,
      cart: [
        { cart_line_id: "p1", product_id: "p1", name: "Menu", quantity: 1, price: 50 },
        { cart_line_id: "p1:special::0.00", product_id: "p1", name: "Menu", quantity: 1, price: 40 }
      ],
      member: null
    });

    expect(payload.payload.items).toEqual([
      { product_id: "p1", quantity: 1, unit_price: 50, notes: null },
      { product_id: "p1", quantity: 1, unit_price: 40, notes: null }
    ]);
  });

  it("persists special price in product metadata and exposes it to stock management", () => {
    const catalog = source("src/app/api/backoffice/catalog/route.ts");
    const stockPage = source("src/app/preview/pos/stock/page.tsx");
    const stockTable = source("src/components/pos-preview/stock-products-table.tsx");
    const addProduct = source("src/components/pos-preview/add-product-popup-button.tsx");
    const editProduct = source("src/components/pos-preview/edit-product-popup-button.tsx");

    expect(catalog).toContain("special_price?: number | null");
    expect(catalog).toContain("withProductManagementMetadata");
    expect(catalog).toContain('fail("invalid_special_price"');
    expect(stockPage).toContain("getProductSpecialPrice(row.metadata)");
    expect(stockTable).toContain('th ? "ราคาพิเศษ" : "Special Price"');
    expect(addProduct).toContain("special_price: resolvedSpecialPrice");
    expect(editProduct).toContain("special_price: resolvedSpecialPrice");
  });

  it("opens a regular/special price selector only for takeaway and dine-in and preserves separate cart lines", () => {
    const salesUi = source("src/components/pos/pos-sales-module.tsx");

    expect(salesUi).toContain('if (quickMode !== "home" && quickMode !== "dine_in") return null;');
    expect(salesUi).toContain("getSelectableSpecialPrice(product)");
    expect(salesUi).toContain("useSpecialPrice");
    expect(salesUi).toContain(":special:");
    expect(salesUi).toContain('localSaleLabel("ราคาปกติ", "Regular Price")');
    expect(salesUi).toContain('localSaleLabel("ราคาพิเศษ", "Special Price")');
    expect(salesUi).toContain("getProductBasePrice(modifierDraft.product, specialSelected)");
  });

  it("keeps duplicate product lines at their own requested unit prices on the server", () => {
    const salesRoute = source("src/app/api/pos/sales/route.ts");

    expect(salesRoute).toContain("requested_unit_price: item.unit_price");
    expect(salesRoute).toContain("sanitizeUnitPrice(item.requested_unit_price, basePrice)");
    expect(salesRoute).not.toContain(
      "body.items.find((entry) => entry.product_id === item.product_id)?.unit_price"
    );
  });

  it("exposes special price in the POS sales catalog while keeping delivery mapped pricing authoritative", () => {
    const salesRoute = source("src/app/api/pos/sales/route.ts");

    expect(salesRoute).toContain("special_price: getProductSpecialPrice(row.metadata)");
    expect(salesRoute).toContain("is_recommended: isProductRecommended(row.metadata)");
    expect(salesRoute).toContain("unit_price: sanitizeUnitPrice(appPrice, basePrice)");
  });
});
