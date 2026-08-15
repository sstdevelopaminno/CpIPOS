import { describe, expect, it } from "vitest";
import {
  DEFAULT_POS_SALES_MODE_ORDER,
  buildPosSalesModeOrderStorageKey,
  getHiddenPosSalesModes,
  getVisiblePosSalesModeOrder,
  normalizePosSalesModeOrder,
  parsePosScopeIdentity,
  swapPosSalesModes
} from "@/lib/pos-sales-mode-preferences";

const FG0003_TENANT_ID = "2d38bd23-bf2d-4b9a-a7cf-adb2547297ed";
const FG0003_BRANCH_ID = "41eee367-6762-4277-bfc8-c2e9776a8ef9";

describe("POS sales mode preferences", () => {
  it("hides buffet table and delivery only for FG0003", () => {
    expect(getHiddenPosSalesModes(FG0003_TENANT_ID)).toEqual(["buffet_table", "delivery"]);
    expect(getVisiblePosSalesModeOrder(DEFAULT_POS_SALES_MODE_ORDER, FG0003_TENANT_ID)).toEqual(["home", "dine_in"]);
    expect(getHiddenPosSalesModes("another-tenant")).toEqual([]);
    expect(getVisiblePosSalesModeOrder(DEFAULT_POS_SALES_MODE_ORDER, "another-tenant")).toEqual([
      "home",
      "dine_in",
      "buffet_table",
      "delivery"
    ]);
  });

  it("normalizes stored mode order without losing supported modes", () => {
    expect(normalizePosSalesModeOrder(["delivery", "home", "delivery", "unknown"])).toEqual([
      "delivery",
      "home",
      "dine_in",
      "buffet_table"
    ]);
  });

  it("swaps dragged modes while preserving all mode identities", () => {
    expect(swapPosSalesModes(DEFAULT_POS_SALES_MODE_ORDER, "home", "delivery")).toEqual([
      "delivery",
      "dine_in",
      "buffet_table",
      "home"
    ]);
  });

  it("namespaces persistence by tenant and branch scope", () => {
    const scope = parsePosScopeIdentity(`${FG0003_TENANT_ID}:${FG0003_BRANCH_ID}`);
    expect(scope).toEqual({ tenantId: FG0003_TENANT_ID, branchId: FG0003_BRANCH_ID });
    expect(scope && buildPosSalesModeOrderStorageKey(scope)).toBe(
      `pos_sales_mode_order_v1:${FG0003_TENANT_ID}:${FG0003_BRANCH_ID}`
    );
    expect(parsePosScopeIdentity("broken-scope")).toBeNull();
  });
});
