import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { StockReadinessClient } from "@/components/sales/stock-readiness-client";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  price: number | null;
  is_active: boolean | null;
};

type IngredientRow = {
  id: string;
  name: string | null;
  base_unit: string | null;
  quantity_on_hand: number | null;
  reorder_level: number | null;
};

type OrderRow = {
  id: string;
  order_no: string | null;
  status: string | null;
  grand_total: number | null;
  total_amount: number | null;
  created_at: string | null;
};

function money(value: number) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function StockReadinessPage() {
  const { scope, shift } = await requireOpenShift("sales:view");
  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: products }, { data: ingredients }, { data: todayOrders }, { data: shiftOrders }] = await Promise.all([
    supabase
      .from("products")
      .select("id,sku,name,category,price,is_active")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .limit(200),
    supabase
      .from("ingredients")
      .select("id,name,base_unit,quantity_on_hand,reorder_level")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .order("quantity_on_hand", { ascending: true })
      .order("name", { ascending: true })
      .limit(200),
    supabase
      .from("orders")
      .select("id,order_no,status,grand_total,total_amount,created_at")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .gte("created_at", `${today}T00:00:00.000Z`)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("orders")
      .select("id,order_no,status,grand_total,total_amount,created_at")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("shift_id", shift.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const productRows = ((products ?? []) as ProductRow[]).filter((product) => product.id && product.name);
  const ingredientRows = ((ingredients ?? []) as IngredientRow[]).filter((ingredient) => ingredient.id);
  const todayOrderRows = (todayOrders ?? []) as OrderRow[];
  const shiftOrderRows = (shiftOrders ?? []) as OrderRow[];
  const paidToday = todayOrderRows.filter((order) => order.status === "completed" || order.status === "paid");
  const activeShiftOrders = shiftOrderRows.filter((order) => order.status !== "cancelled");
  const todayTotal = paidToday.reduce((sum, order) => sum + Number(order.grand_total ?? order.total_amount ?? 0), 0);
  const activeProducts = productRows.filter((product) => product.is_active !== false);
  const lowIngredients = ingredientRows.filter((ingredient) => {
    const quantity = Number(ingredient.quantity_on_hand ?? 0);
    const reorder = Number(ingredient.reorder_level ?? 0);
    return quantity <= 0 || (reorder > 0 && quantity <= reorder);
  });

  return (
    <MobileAppShell scope={scope}>
      <StockReadinessClient
        stats={{
          todayTotal: `${money(todayTotal)} ฿`,
          activeOrderCount: String(activeShiftOrders.length),
          activeProductCount: String(activeProducts.length),
          lowIngredientCount: String(lowIngredients.length),
        }}
        products={activeProducts.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name ?? "-",
          category: product.category || "อื่นๆ",
          price: Number(product.price ?? 0),
        }))}
        ingredients={ingredientRows.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          baseUnit: ingredient.base_unit,
          quantityOnHand: Number(ingredient.quantity_on_hand ?? 0),
          reorderLevel: Number(ingredient.reorder_level ?? 0),
        }))}
      />
    </MobileAppShell>
  );
}
