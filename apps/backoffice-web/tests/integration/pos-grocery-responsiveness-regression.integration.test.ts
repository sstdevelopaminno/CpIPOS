import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const modeLib = source("../../src/lib/pos-general-sale-mode.ts");
const tableOnlyGuard = source("../../src/components/pos/pos-grocery-table-only-guard.tsx");
const cartBridge = source("../../src/components/pos/pos-general-sale-cart-reconcile-bridge.tsx");
const posPage = source("../../src/app/preview/pos/page.tsx");

describe("grocery POS responsiveness regression", () => {
  it("keeps general-sale on scanner/table layout instead of the product-grid path", () => {
    expect(modeLib).toContain('return "table"');
    expect(tableOnlyGuard).toContain('GENERAL_SALE_LAYOUT_STORAGE_KEY, "table"');
    expect(tableOnlyGuard).toContain('.posui-product-grid-wrap');
    expect(tableOnlyGuard).toContain('display: none !important');
    expect(tableOnlyGuard).toContain('[data-sd-layout="grid"]');
  });

  it("mounts the production table-only guard before the general-sale controller", () => {
    expect(posPage).toContain('import { PosGroceryTableOnlyGuard }');
    const guardIndex = posPage.indexOf("<PosGroceryTableOnlyGuard />");
    const controllerIndex = posPage.indexOf("<PosGeneralSaleModeController />");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(controllerIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(controllerIndex);
  });

  it("coalesces cart reconciliation instead of firing five delayed DOM nudges", () => {
    expect(cartBridge).toContain('const SETTLE_DELAY_MS = 120');
    expect(cartBridge).toContain('queueMicrotask');
    expect(cartBridge).toContain('cpipos:pos-cart-mutated');
    expect(cartBridge).not.toContain('NUDGE_DELAYS_MS');
    expect(cartBridge).not.toContain('[0, 80, 220, 520, 900]');
    expect(cartBridge).not.toContain('data-cpipos-cart-reconcile-nudge');
  });
});
