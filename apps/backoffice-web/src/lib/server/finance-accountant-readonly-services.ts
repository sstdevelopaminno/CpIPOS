import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import type { FinanceIdentity } from "@/lib/server/finance-session";
import { orderCurrencyFromMetadata, type SalesCurrencyCode } from "@/lib/pos-money";
import { parseFinanceDateRange, todayBangkok } from "@/lib/finance-sales-analytics";

export type FinanceCatalogRow = {
  id: string;
  branchId: string | null;
  name: string;
  sku: string | null;
  category: string | null;
  price: number | null;
};
export type FinanceProductSalesRow = {
  product: string;
  branchName: string;
  currency: SalesCurrencyCode;
  quantity: number;
  lineTotal: number;
  lines: number;
};
const MAX_PRODUCTS = 500;
const MAX_ORDERS = 500;
const MAX_LINES_PER_BATCH = 900;

function amount(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error("finance_invalid_item_amount");
  return n;
}

/** Read-only, tenant-restricted inventory catalog for an Accountant authorized
 * in every active tenant branch. Does NOT change stock, SKU or prices.
 */
export async function loadAccountantProductCatalog(identity: FinanceIdentity): Promise<FinanceCatalogRow[]> {
  const db = getSupabaseServiceClient();
  const result = await db.from("products")
    .select("id,branch_id,name,sku,category,price", { count: "exact" })
    .eq("tenant_id", identity.tenantId)
    .eq("is_active", true).is("deleted_at", null)
    .order("name", { ascending: true }).limit(MAX_PRODUCTS);
  if (result.error || result.count === null) throw new Error("finance_catalog_unavailable");
  if (result.count > MAX_PRODUCTS) throw new Error("finance_catalog_too_large");
  const grants = new Set(identity.branchIds);
  return (result.data ?? [])
    .filter(item => !item.branch_id || grants.has(String(item.branch_id)))
    .map(item => ({
      id: String(item.id), branchId: item.branch_id ? String(item.branch_id) : null,
      name: String(item.name ?? ""), sku: item.sku ? String(item.sku) : null,
      category: item.category ? String(item.category) : null,
      price: item.price === null ? null : amount(item.price)
    }));
}

/** Product line detail from completed orders; not the net collected sales or VAT
 * ledger. Per-branch/currency aggregation is never combined across currencies.
 */
export async function loadAccountantProductSales(identity: FinanceIdentity): Promise<{
  from: string;
  to: string;
  orders: number;
  rows: FinanceProductSalesRow[];
}> {
  const db = getSupabaseServiceClient();
  const today = todayBangkok();
  const startDate = new Date(Date.parse(today + "T00:00:00+07:00") - 6 * 86_400_000);
  const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(startDate);
  const range = parseFinanceDateRange(from, today);
  const branchIds = identity.branchIds;
  if (!branchIds.length) throw new Error("finance_no_authorized_branches");
  const branches = await db.from("branches").select("id,name")
    .eq("tenant_id", identity.tenantId).in("id", branchIds);
  if (branches.error) throw new Error("finance_branches_unavailable");
  const branchNames = new Map((branches.data ?? []).map(item => [String(item.id), String(item.name)]));
  const ordersResult = await db.from("orders")
    .select("id,branch_id,metadata", { count: "exact" })
    .eq("tenant_id", identity.tenantId).in("branch_id", branchIds)
    .eq("status", "completed")
    .gte("payment_completed_at", range.startIso)
    .lt("payment_completed_at", range.endExclusiveIso)
    .order("payment_completed_at", { ascending: false }).limit(MAX_ORDERS);
  if (ordersResult.error || ordersResult.count === null) throw new Error("finance_product_sales_unavailable");
  if (ordersResult.count > MAX_ORDERS) throw new Error("finance_product_sales_too_many_orders");
  const orders = ordersResult.data ?? [];
  const map = new Map(orders.map(order => [String(order.id), {
    branchId: String(order.branch_id), currency: orderCurrencyFromMetadata(order.metadata)
  }]));
  const aggregate = new Map<string, FinanceProductSalesRow>();
  for (let index = 0; index < orders.length; index += 100) {
    const batch = orders.slice(index, index + 100).map(row => String(row.id));
    const lines = await db.from("order_items")
      .select("id,order_id,product_id,name,quantity,line_total", { count: "exact" })
      .eq("tenant_id", identity.tenantId).in("branch_id", branchIds)
      .in("order_id", batch).limit(MAX_LINES_PER_BATCH);
    if (lines.error || lines.count === null) throw new Error("finance_product_lines_unavailable");
    if (lines.count >= MAX_LINES_PER_BATCH) throw new Error("finance_product_lines_too_many");
    for (const line of lines.data ?? []) {
      const parent = map.get(String(line.order_id));
      if (!parent) continue;
      const product = String(line.name ?? "ไม่ระบุสินค้า");
      const key = parent.branchId + "|" + parent.currency + "|" + String(line.product_id ?? product);
      const current = aggregate.get(key) ?? {
        product, branchName: branchNames.get(parent.branchId) ?? "ไม่ระบุสาขา",
        currency: parent.currency, quantity: 0, lineTotal: 0, lines: 0
      };
      current.quantity += amount(line.quantity);
      current.lineTotal = Math.round((current.lineTotal + amount(line.line_total)) * 100) / 100;
      current.lines++;
      aggregate.set(key, current);
    }
  }
  return {
    from: range.from, to: range.to, orders: orders.length,
    rows: [...aggregate.values()].sort((a, b) => a.branchName.localeCompare(b.branchName) || a.product.localeCompare(b.product))
  };
}
