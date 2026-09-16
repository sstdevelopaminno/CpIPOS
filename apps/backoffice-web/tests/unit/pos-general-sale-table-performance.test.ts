import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const page = readSource("src/app/preview/pos/page.tsx");
const controller = readSource("src/components/pos/pos-general-sale-table-controller.tsx");

describe("POS general-sale table-only performance contract", () => {
  it("mounts the optimized table-only controller instead of the legacy grid/table controller", () => {
    expect(page).toContain("PosGeneralSaleTableController");
    expect(page).not.toContain("PosGeneralSaleModeController");
  });

  it("keeps grocery/general-sale on table layout only", () => {
    expect(controller).toContain('window.localStorage.setItem(GENERAL_SALE_LAYOUT_STORAGE_KEY, "table")');
    expect(controller).toContain('document.documentElement.setAttribute(GENERAL_SALE_LAYOUT_ATTRIBUTE, "table")');
    expect(controller).toContain('lang === "th" ? "ตาราง" : "Table"');
    expect(controller).not.toContain('data.sdLayout = "grid"');
    expect(controller).not.toContain('"สินค้า + ตะกร้า"');
  });

  it("coalesces DOM reconciliation to one animation frame and ignores its own table/scanner mutations", () => {
    expect(controller).toContain("window.requestAnimationFrame");
    expect(controller).toContain("mutations.every(isInternalMutation)");
    expect(controller).toContain('document.visibilityState !== "visible"');
  });

  it("renders cart changes from the POS cart event instead of waiting on broad DOM mutation churn", () => {
    expect(controller).toContain('const CART_MUTATED_EVENT = "cpipos:pos-cart-mutated"');
    expect(controller).toContain('window.addEventListener(CART_MUTATED_EVENT, onCartMutated)');
    expect(controller).toContain("scheduleTableRender(0)");
  });
});
