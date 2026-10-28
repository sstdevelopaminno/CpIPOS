import { describe, expect, it } from "vitest";
import {
  DEFAULT_POS_SALES_MODE_ORDER,
  getAuthorizedCustomPosStartupMode,
  buildPosSalesModeOrderStorageKey,
  canManageBranchSalesModeOrder,
  getHiddenPosSalesModes,
  getVisiblePosSalesModeOrder,
  normalizePosSalesModeOrder,
  parsePosScopeIdentity,
  swapPosSalesModes
} from "@/lib/pos-sales-mode-preferences";
import { resolveProductProfile } from "@/lib/product-profile-policy";

const TENANT_ID = "2d38bd23-bf2d-4b9a-a7cf-adb2547297ed";
const BRANCH_ID = "41eee367-6762-4277-bfc8-c2e9776a8ef9";

describe("POS sales mode preferences", () => {
  it("hides sales modes by product profile instead of tenant id", () => {
    expect(getHiddenPosSalesModes(TENANT_ID, "RESTAURANT_QR")).toEqual(["buffet_table", "delivery"]);
    expect(getVisiblePosSalesModeOrder(DEFAULT_POS_SALES_MODE_ORDER, TENANT_ID, "RESTAURANT_QR")).toEqual(["home", "dine_in"]);
    expect(getHiddenPosSalesModes("another-tenant", "BUFFET")).toEqual(["home", "dine_in", "delivery"]);
    expect(getVisiblePosSalesModeOrder(DEFAULT_POS_SALES_MODE_ORDER, "another-tenant", "BUFFET")).toEqual(["buffet_table"]);
    expect(getHiddenPosSalesModes("another-tenant", "STANDARD")).toEqual([]);
  });

  it("resolves FG/FF family codes as transitional product profiles", () => {
    expect(resolveProductProfile({ tenantCode: "FG0004" })).toBe("RESTAURANT_QR");
    expect(resolveProductProfile({ tenantCode: "FF0001" })).toBe("BUFFET");
    expect(resolveProductProfile({ tenantCode: "900001", tenantMetadata: { product_profile: "BUFFET" } })).toBe("BUFFET");
  });

  it("starts IMDC OPTICAL when it is the only IT-authorized CUSTOM mode", () => {
    expect(getAuthorizedCustomPosStartupMode(
      DEFAULT_POS_SALES_MODE_ORDER, "STANDARD",
      { takeaway: false, dine_in: false, buffet_table: false, delivery: false, general_sale: false, optical_retail: true }
    )).toBe("optical_retail");
  });

  it("does not enter an unauthorized home/takeaway mode when no mode is granted", () => {
    expect(getAuthorizedCustomPosStartupMode(DEFAULT_POS_SALES_MODE_ORDER, "STANDARD", {})).toBeNull();
  });

  it("respects branch order among enabled modes rather than defaulting to home", () => {
    expect(getAuthorizedCustomPosStartupMode(
      ["home", "buffet_table", "dine_in", "delivery"], "STANDARD",
      { takeaway: false, dine_in: true, buffet_table: true, optical_retail: true }
    )).toBe("buffet_table");
  });

  it("respects product-profile restrictions even when a mode was granted", () => {
    expect(getAuthorizedCustomPosStartupMode(
      DEFAULT_POS_SALES_MODE_ORDER, "BUFFET",
      { takeaway: true, dine_in: true, buffet_table: true }
    )).toBe("buffet_table");
  });

  it("can auto-select general sale without exposing takeaway", () => {
    expect(getAuthorizedCustomPosStartupMode(
      DEFAULT_POS_SALES_MODE_ORDER, "STANDARD", { general_sale: true }
    )).toBe("general_sale");
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

  it("namespaces fallback cache by tenant and branch scope", () => {
    const scope = parsePosScopeIdentity(`${TENANT_ID}:${BRANCH_ID}`);
    expect(scope).toEqual({ tenantId: TENANT_ID, branchId: BRANCH_ID });
    expect(scope && buildPosSalesModeOrderStorageKey(scope)).toBe(
      `pos_sales_mode_order_v1:${TENANT_ID}:${BRANCH_ID}`
    );
    expect(parsePosScopeIdentity("broken-scope")).toBeNull();
  });

  it("allows branch-wide ordering only for owner, manager, or IT admin", () => {
    expect(canManageBranchSalesModeOrder("owner", "tenant_user")).toBe(true);
    expect(canManageBranchSalesModeOrder("manager", "tenant_user")).toBe(true);
    expect(canManageBranchSalesModeOrder("staff", "tenant_user")).toBe(false);
    expect(canManageBranchSalesModeOrder("accountant", "tenant_user")).toBe(false);
    expect(canManageBranchSalesModeOrder(null, "it_admin")).toBe(true);
  });
});
