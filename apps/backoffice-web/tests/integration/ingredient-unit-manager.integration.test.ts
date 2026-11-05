import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const rootSrc = (path: string) => readFileSync(resolve(process.cwd(), "../..", path), "utf8");

describe("ingredient unit manager", () => {
  it("persists branch-scoped unit definitions behind service-role-only RLS", () => {
    const migration = rootSrc("supabase/migrations/20261105164401_ingredient_unit_definitions_20261105.sql");
    expect(migration).toContain("create table if not exists public.ingredient_unit_definitions");
    expect(migration).toContain("unique (tenant_id, branch_id, unit_value)");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.ingredient_unit_definitions from anon, authenticated");
    expect(migration).toContain("grant select, insert, update, delete on table public.ingredient_unit_definitions to service_role");
  });

  it("exposes list/create/rename/delete actions scoped to the selected branch", () => {
    const route = src("src/app/api/backoffice/catalog/route.ts");
    expect(route).toContain('view === "ingredient_units"');
    expect(route).toContain('body.action === "create_ingredient_unit"');
    expect(route).toContain('body.action === "rename_ingredient_unit"');
    expect(route).toContain('body.action === "delete_ingredient_unit"');
    expect(route).toContain('.eq("branch_id", scopedBranchId)');
    expect(route).toContain("custom_piece_");
    expect(route).toContain("usage_count");
  });

  it("treats customer-created units as count units in both web and native catalog paths", () => {
    const backoffice = src("src/app/api/backoffice/catalog/route.ts");
    const native = src("src/app/api/pos/catalog-management/route.ts");
    expect(backoffice).toContain('normalized.startsWith("custom_piece_")');
    expect(backoffice).toContain('ingredientBaseUnit.startsWith("custom_piece_")');
    expect(native).toContain('unit.startsWith("custom_piece_")');
  });

  it("shows managed units in the Stock toolbar, filter and ingredient editor", () => {
    const table = src("src/components/pos-preview/stock-products-table.tsx");
    const popup = src("src/components/pos-preview/ingredient-unit-manage-popup-button.tsx");
    expect(table).toContain("<IngredientUnitManagePopupButton");
    expect(table).toContain("reloadIngredientUnits");
    expect(table).toContain("ingredientUnitOptions.map");
    expect(table).toContain("ingredientUnitDisplayLabel");
    expect(popup).toContain('th ? "จัดการหน่วยวัตถุดิบ"');
    expect(popup).toContain('action: "create_ingredient_unit"');
    expect(popup).toContain('action: "rename_ingredient_unit"');
    expect(popup).toContain('action: "delete_ingredient_unit"');
    expect(popup).toContain('window.addEventListener("keydown"');
    expect(popup).toContain("window.clearTimeout(closeTimerRef.current)");
  });

  it("hardens product-management modals against save/close races and stale body scroll", () => {
    for (const file of [
      "src/components/pos-preview/add-product-popup-button.tsx",
      "src/components/pos-preview/edit-product-popup-button.tsx",
      "src/components/pos-preview/category-manage-popup-button.tsx",
      "src/components/pos-preview/stock-settings-popup-button.tsx"
    ]) {
      const source = src(file);
      expect(source).toContain('document.body.style.overflow = "hidden"');
      expect(source).toContain("window.addEventListener(\"keydown\"");
      expect(source).toContain("window.clearTimeout(closeTimerRef.current)");
    }
  });
});
