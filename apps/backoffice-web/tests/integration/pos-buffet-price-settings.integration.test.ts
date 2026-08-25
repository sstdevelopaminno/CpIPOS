import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const settingsRoute = source("../../src/app/api/pos/buffet-products/settings/route.ts");
const settingsPage = source("../../src/app/preview/pos/buffet-pricing/page.tsx");
const workspace = source("../../src/components/pos-preview/pos-buffet-price-settings-workspace.tsx");
const moreWorkspace = source("../../src/components/pos-preview/pos-more-workspace.tsx");
const featureMap = source("../../src/lib/pos-feature-map.ts");
const picker = source("../../src/components/pos/pos-buffet-price-picker-modal.tsx");

describe("POS Buffet Table branch price settings", () => {
  it("adds the requested Buffet price submenu to More and protects it with table management", () => {
    expect(moreWorkspace).toContain('href:"/preview/pos/buffet-pricing"');
    expect(moreWorkspace).toContain('th:"ตั้งค่าราคาบุฟเฟ่"');
    expect(featureMap).toContain('"/preview/pos/buffet-pricing": "table_management"');
    expect(settingsPage).toContain('requirePosPagePermission("tables:manage")');
  });

  it("renders a table-style editor for per-person and set prices", () => {
    expect(workspace).toContain("<table");
    expect(workspace).toContain("pagePlans.map((plan) => {");
    expect(workspace).toContain("Buffet plan");
    expect(workspace).toContain("Type");
    expect(workspace).toContain("Current price");
    expect(workspace).toContain("New price");
    expect(workspace).toContain("Save");
  });

  it("updates the same branch product price that the Buffet sales resolver reads", () => {
    expect(settingsRoute).toContain('.from("products")');
    expect(settingsRoute).toContain('.update({ price })');
    expect(settingsRoute).toContain('.eq("tenant_id", tenantId)');
    expect(settingsRoute).toContain('.eq("branch_id", branchId)');
    expect(settingsRoute).toContain("DEFAULT_BUFFET_PRICE_PLANS.find");
    expect(workspace).toContain('fetch("/api/pos/buffet-products/settings"');
    expect(picker).toContain('fetch("/api/pos/buffet-products/resolve"');
  });

  it("does not reactivate an existing disabled buffet product while editing its price", () => {
    expect(settingsRoute).toContain('.update({ price })');
    expect(settingsRoute).not.toContain('.update({ price, is_active: true })');
    expect(workspace).toContain("plan.is_active");
    expect(workspace).toContain("Inactive");
  });

  it("keeps the keypad default separate from the first operator-entered digit", () => {
    expect(picker).toContain("selectBuffetQuickQuantity(value)");
    expect(picker).toContain("adjustBuffetQuantity(current, -1)");
    expect(picker).toContain("adjustBuffetQuantity(current, 1)");
  });
});
