import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shouldOpenPosItemDetailPopup } from "../../src/lib/pos-item-detail-popup-policy";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("POS item-detail popup setting", () => {
  it("preserves the old popup behavior by default", () => {
    expect(shouldOpenPosItemDetailPopup({}, true)).toBe(true);
    expect(shouldOpenPosItemDetailPopup({ has_recipe_deduction: true }, true)).toBe(true);
  });
  it("bypasses optional popups for ordinary products when disabled", () => {
    expect(shouldOpenPosItemDetailPopup({ has_recipe_deduction: false }, false)).toBe(false);
    expect(shouldOpenPosItemDetailPopup({}, false)).toBe(false);
  });
  it("always retains the ingredient selector when disabled", () => {
    expect(shouldOpenPosItemDetailPopup({ has_recipe_deduction: true }, false)).toBe(true);
  });
  it("keeps explicit cart editing available and isolates branch preferences", () => {
    const sales = read("src/components/pos/pos-sales-module.tsx");
    expect(sales).toContain("shouldOpenPosItemDetailPopup(product, itemDetailPopupEnabled)");
    expect(sales).toContain("function openCartLineEditor(item: CartItem)");
    expect(sales).toContain("itemDetailPopupPolicy?.branchId === posScope.branchId");
    expect(sales).toContain("item_detail_popup_branch_mismatch");
    expect(sales).toContain("itemDetailPopupPolicy?.tenantId === posScope.tenantId");
  });
  it("persists a branch-specific setting without a QR feature entitlement", () => {
    const page = read("src/components/pos-preview/order-kitchen-settings-page.tsx");
    const route = read("src/app/api/pos/settings/order-kitchen/route.ts");
    const service = read("src/lib/services/table-qr-automation-policy-service.ts");
    const runtime = read("src/app/api/pos/sales/item-detail-popup-policy/route.ts");
    expect(page).toContain("item_detail_popup_enabled: draft.item_detail_popup_enabled");
    expect(route).toContain("wantsItemDetailPopup");
    expect(service).toContain("pos_item_detail_popup_enabled: nextItemDetailPopup");
    expect(runtime).toContain('requiredPermission: "sales:enter"');
    expect(runtime).toContain("branch_id: branchId");
    expect(runtime).not.toContain("qr_table_ordering");
  });
  it("renders a larger, legible notes field and a character counter", () => {
    const sales = read("src/components/pos/pos-sales-module.tsx");
    expect(sales).toContain("modifierDraft.detailNote.length}/500");
    expect(sales).toContain("border-2 border-slate-300 bg-white");
    expect(sales).toContain("rows={3}");
  });
});
