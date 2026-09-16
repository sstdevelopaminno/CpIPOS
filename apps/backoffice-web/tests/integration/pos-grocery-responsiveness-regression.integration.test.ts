import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const modeLib = source("../../src/lib/pos-general-sale-mode.ts");
const tableOnlyGuard = source("../../src/components/pos/pos-grocery-table-only-guard.tsx");
const tableController = source("../../src/components/pos/pos-general-sale-table-controller.tsx");
const cartBridge = source("../../src/components/pos/pos-general-sale-cart-reconcile-bridge.tsx");
const runtime = source("../../src/components/pos/pos-general-sale-runtime.tsx");
const policyController = source("../../src/components/pos/pos-sales-mode-policy-controller.tsx");
const posPage = source("../../src/app/preview/pos/page.tsx");

describe("grocery POS responsiveness regression", () => {
  it("keeps general-sale on scanner/table layout instead of the product-grid path", () => {
    expect(modeLib).toContain('return "table"');
    expect(tableOnlyGuard).toContain('GENERAL_SALE_LAYOUT_STORAGE_KEY, "table"');
    expect(tableOnlyGuard).toContain('.posui-product-grid-wrap');
    expect(tableOnlyGuard).toContain('display: none !important');
    expect(tableOnlyGuard).toContain('[data-sd-layout="grid"]');
    expect(tableOnlyGuard).toContain('getAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE) !== "table"');
    expect(tableController).toContain('lang === "th" ? "ตาราง" : "Table"');
    expect(tableController).not.toContain('"สินค้า + ตะกร้า"');
  });

  it("mounts the table-only guard before the optimized general-sale controller", () => {
    expect(posPage).toContain('import { PosGroceryTableOnlyGuard }');
    expect(posPage).toContain('import { PosGeneralSaleTableController }');
    const guardIndex = posPage.indexOf("<PosGroceryTableOnlyGuard />");
    const controllerIndex = posPage.indexOf("<PosGeneralSaleTableController />");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(controllerIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(controllerIndex);
    expect(posPage).not.toContain("<PosGeneralSaleModeController />");
  });

  it("coalesces the controller's broad DOM reconciliation and ignores controller-owned mutations", () => {
    expect(tableController).toContain("window.requestAnimationFrame");
    expect(tableController).toContain("mutations.every(isInternalMutation)");
    expect(tableController).toContain('document.visibilityState !== "visible"');
    expect(tableController).toContain('window.addEventListener(CART_MUTATED_EVENT, onCartMutated)');
  });

  it("keeps grocery-only document observers unmounted outside grocery mode", () => {
    expect(posPage).toContain("<PosGeneralSaleRuntime />");
    expect(posPage).not.toContain("<PosGeneralSaleCartReconcileBridge />");
    expect(posPage).not.toContain("<PosGeneralSaleFrontCashPanel />");
    expect(runtime).toContain("if (!active) return null");
    expect(runtime).toContain("<PosGeneralSaleCartReconcileBridge />");
    expect(runtime).toContain("<PosGeneralSaleFrontCashPanel />");
  });

  it("coalesces cart reconciliation instead of firing five delayed DOM nudges", () => {
    expect(cartBridge).toContain('const SETTLE_DELAY_MS = 120');
    expect(cartBridge).toContain('queueMicrotask');
    expect(cartBridge).toContain('cpipos:pos-cart-mutated');
    expect(cartBridge).not.toContain('NUDGE_DELAYS_MS');
    expect(cartBridge).not.toContain('[0, 80, 220, 520, 900]');
    expect(cartBridge).not.toContain('data-cpipos-cart-reconcile-nudge');
  });

  it("coalesces IT sales-mode DOM policy work to one animation frame", () => {
    expect(policyController).toContain("requestAnimationFrame");
    expect(policyController).toContain("scheduleApplyPolicy");
    expect(policyController).toContain("POLICY_REFRESH_MS = 60_000");
    expect(policyController).not.toContain("new MutationObserver(() => applyPolicy())");
  });
});
