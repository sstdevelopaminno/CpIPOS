import { describe, expect, it } from "vitest";
import { buffetPlanModeFromProduct, buildBuffetPlanMetadata, isBuffetPlanProduct } from "../../src/lib/pos-buffet-plan-product";

describe("buffet plan product classification", () => {
  it("recognizes canonical legacy buffet SKUs", () => {
    expect(buffetPlanModeFromProduct({ sku: "BUFFET-PER-PERSON", name: "บุฟเฟ่รายท่าน", metadata: {} })).toBe("per_person");
    expect(buffetPlanModeFromProduct({ sku: "BUFFET-SET", name: "บุฟเฟ่แบบชุด", metadata: {} })).toBe("set");
  });

  it("recognizes dynamic plans only through explicit buffet metadata", () => {
    const metadata = buildBuffetPlanMetadata({ mode: "set", draft: false, sortOrder: 10 });
    expect(buffetPlanModeFromProduct({ sku: "BUFFET-SET-ABC123", name: "บุฟเฟ่แบบชุด 2", metadata })).toBe("set");
  });

  it("does not classify an ordinary product merely because its category is buffet", () => {
    const ordinaryProduct = { sku: "PRD-091933", name: "โอเลี้ยง", metadata: {} };
    expect(isBuffetPlanProduct(ordinaryProduct)).toBe(false);
    expect(buffetPlanModeFromProduct(ordinaryProduct)).toBeNull();
  });
});
