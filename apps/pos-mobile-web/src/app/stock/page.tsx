import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { StockRealtimeClient, type StockSnapshot } from "@/components/stock/stock-realtime-client";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type IngredientRow = {
  id: string;
  name: string | null;
  base_unit: string | null;
  quantity_on_hand: number | null;
  reorder_level: number | null;
  updated_at: string | null;
};

type ProductRow = {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  price: number | null;
  is_active: boolean | null;
  stock_deduction_mode: string | null;
  updated_at: string | null;
};

type CategoryRow = {
  name: string | null;
};

type MovementRow = {
  id: string;
  ingredient_id: string | null;
  quantity_delta: number | null;
  reason: string | null;
  created_at: string | null;
};

function toStockStatus(row: IngredientRow): "ok" | "low" | "out" {
  const quantity = Number(row.quantity_on_hand ?? 0);
  const reorder = Number(row.reorder_level ?? 0);
  if (quantity <= 0) return "out";
  if (reorder > 0 && quantity <= reorder) return "low";
  return "ok";
}

async function loadStockSnapshot(tenantId: string, branchId: string): Promise<StockSnapshot> {
  const supabase = createServiceClient();
  const [productsResult, ingredientsResult, movementsResult, categoriesResult] = await Promise.all([
    supabase
      .from("products")
      .select("id,sku,name,category,price,is_active,stock_deduction_mode,updated_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .limit(100),
    supabase
      .from("ingredients")
      .select("id,name,base_unit,quantity_on_hand,reorder_level,updated_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("quantity_on_hand", { ascending: true })
      .order("name", { ascending: true })
      .limit(100),
    supabase
      .from("stock_movements")
      .select("id,ingredient_id,quantity_delta,reason,created_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("movement_type", "sale_deduction")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("product_categories")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("name", { ascending: true }),
  ]);

  if (productsResult.error) throw new Error(productsResult.error.message);
  if (ingredientsResult.error) throw new Error(ingredientsResult.error.message);
  if (movementsResult.error) throw new Error(movementsResult.error.message);
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);

  const products = ((productsResult.data ?? []) as ProductRow[]).map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name ?? "-",
    category: row.category ?? "-",
    price: Number(row.price ?? 0),
    isActive: Boolean(row.is_active),
    stockDeductionMode: row.stock_deduction_mode ?? "unit_only",
    updatedAt: row.updated_at,
  }));
  const ingredients = ((ingredientsResult.data ?? []) as IngredientRow[]).map((row) => ({
    id: row.id,
    name: row.name ?? "-",
    baseUnit: row.base_unit ?? "",
    quantityOnHand: Number(row.quantity_on_hand ?? 0),
    reorderLevel: Number(row.reorder_level ?? 0),
    updatedAt: row.updated_at,
    status: toStockStatus(row),
  }));

  return {
    products,
    categories: ((categoriesResult.data ?? []) as CategoryRow[]).map((row) => row.name).filter((name): name is string => Boolean(name)),
    ingredients,
    recentSaleDeductions: ((movementsResult.data ?? []) as MovementRow[]).map((row) => ({
      id: row.id,
      ingredientId: row.ingredient_id,
      quantityDelta: Number(row.quantity_delta ?? 0),
      reason: row.reason,
      createdAt: row.created_at,
    })),
    summary: {
      activeProducts: products.filter((item) => item.isActive).length,
      categories: new Set(products.map((item) => item.category)).size,
      trackedIngredients: ingredients.length,
      lowIngredients: ingredients.filter((item) => item.status === "low").length,
      outIngredients: ingredients.filter((item) => item.status === "out").length,
    },
    refreshedAt: new Date().toISOString(),
  };
}

export default async function StockPage() {
  const { scope } = await requireOpenShift("inventory:view");
  const snapshot = await loadStockSnapshot(scope.tenantId, scope.branchId);

  return (
    <MobileAppShell scope={scope}>
      <StockRealtimeClient initialSnapshot={snapshot} />
    </MobileAppShell>
  );
}
