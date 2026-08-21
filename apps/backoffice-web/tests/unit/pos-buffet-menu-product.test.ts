import { describe, expect, it } from "vitest";
import { isBuffetIncludedMenuProduct } from "../../src/lib/pos-buffet-menu-product";

describe("buffet menu product classification", () => {
  it("treats zero-price Buffet category food as included", () => {
    expect(isBuffetIncludedMenuProduct({ sku: "F-001", name: "หมูสไลซ์", category: "บุฟเฟ่", price: 0 })).toBe(true);
    expect(isBuffetIncludedMenuProduct({ sku: "F-002", name: "Vegetables", category: "Buffet", price: 0 })).toBe(true);
  });

  it("keeps priced products as paid extras", () => {
    expect(isBuffetIncludedMenuProduct({ sku: "E-001", name: "ชีสเพิ่ม", category: "บุฟเฟ่", price: 39 })).toBe(false);
    expect(isBuffetIncludedMenuProduct({ sku: "E-002", name: "น้ำอัดลม", category: "เครื่องดื่ม", price: 25 })).toBe(false);
  });

  it("never classifies buffet price-plan products as included food", () => {
    expect(isBuffetIncludedMenuProduct({ sku: "BUFFET-SET", name: "บุฟเฟ่แบบชุด", category: "บุฟเฟ่", price: 599 })).toBe(false);
    expect(isBuffetIncludedMenuProduct({ sku: "BUFFET-PER-PERSON", name: "บุฟเฟ่รายท่าน", category: "บุฟเฟ่", price: 199 })).toBe(false);
  });

  it("supports an explicit metadata flag for future product editors", () => {
    expect(isBuffetIncludedMenuProduct({
      sku: "F-003",
      name: "Special buffet food",
      category: "อาหาร",
      price: 0,
      metadata: { cpipos_buffet_item: { included: true } }
    })).toBe(true);
  });
});
