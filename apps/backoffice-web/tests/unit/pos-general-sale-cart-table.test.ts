import { describe, expect, it } from "vitest";
import {
  buildGeneralSaleCartTableRows,
  buildGeneralSaleCartTableSignature,
  parseGeneralSaleCartStorage,
  parseGeneralSaleSalesSnapshot
} from "../../src/lib/pos-general-sale-cart-table";

describe("POS SD scanner table", () => {
  it("projects the React takeaway cart with SKU and category from the product snapshot", () => {
    const cart = parseGeneralSaleCartStorage(JSON.stringify([
      { cart_line_id: "p1", product_id: "p1", name: "น้ำดื่ม", quantity: 2, price: 12 },
      { cart_line_id: "p2:XL", product_id: "p2", name: "เสื้อยืด", quantity: 1, price: 199, notes: "XL" }
    ]));
    const snapshot = parseGeneralSaleSalesSnapshot(JSON.stringify({
      products: [
        { id: "p1", sku: "8850001", name: "น้ำดื่ม", category: "เครื่องดื่ม", price: 12, is_active: true },
        { id: "p2", sku: "TS-001", name: "เสื้อยืด", category: "เสื้อผ้า", price: 199, is_active: true }
      ]
    }));

    const rows = buildGeneralSaleCartTableRows({ cart, snapshotProducts: snapshot });
    expect(rows).toEqual([
      {
        cartLineId: "p1",
        productId: "p1",
        sku: "8850001",
        category: "เครื่องดื่ม",
        name: "น้ำดื่ม",
        quantity: 2,
        unitPrice: 12,
        lineTotal: 24,
        notes: null
      },
      {
        cartLineId: "p2:XL",
        productId: "p2",
        sku: "TS-001",
        category: "เสื้อผ้า",
        name: "เสื้อยืด",
        quantity: 1,
        unitPrice: 199,
        lineTotal: 199,
        notes: "XL"
      }
    ]);
  });

  it("lets the live scanner lookup override stale product snapshot metadata", () => {
    const cart = parseGeneralSaleCartStorage(JSON.stringify([
      { product_id: "p1", name: "สินค้าใหม่", quantity: 1, price: 49.5 }
    ]));
    const snapshot = parseGeneralSaleSalesSnapshot(JSON.stringify({
      products: [{ id: "p1", sku: "OLD-1", name: "สินค้าเก่า", category: "เก่า", price: 40, is_active: true }]
    }));
    const lookup = [{ id: "p1", sku: "097339", name: "สินค้าใหม่", category: "ขายทั่วไป", price: 49.5, is_active: true }];

    const [row] = buildGeneralSaleCartTableRows({ cart, snapshotProducts: snapshot, lookupProducts: lookup });
    expect(row.sku).toBe("097339");
    expect(row.category).toBe("ขายทั่วไป");
    expect(row.unitPrice).toBe(49.5);
  });

  it("fails soft when browser storage is malformed", () => {
    expect(parseGeneralSaleCartStorage("{bad-json")).toEqual([]);
    expect(parseGeneralSaleCartStorage(JSON.stringify([{ product_id: "", name: "x", quantity: 1, price: 1 }]))).toEqual([]);
    expect(parseGeneralSaleSalesSnapshot("{bad-json")).toEqual([]);
  });

  it("changes the render signature when quantity or metadata changes", () => {
    const base = [{
      cartLineId: "p1",
      productId: "p1",
      sku: "097339",
      category: "ทั่วไป",
      name: "สินค้า",
      quantity: 1,
      unitPrice: 10,
      lineTotal: 10,
      notes: null
    }];
    expect(buildGeneralSaleCartTableSignature(base)).not.toBe(buildGeneralSaleCartTableSignature([{ ...base[0], quantity: 2, lineTotal: 20 }]));
    expect(buildGeneralSaleCartTableSignature(base)).not.toBe(buildGeneralSaleCartTableSignature([{ ...base[0], sku: "097340" }]));
  });
});
