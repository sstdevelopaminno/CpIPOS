import { notFound } from "next/navigation";
import { RecyclingPosWorkspace } from "@/components/pos/recycling-pos-workspace";
import { getRecyclingCatalog, isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/**
 * One authenticated screen used by "หน้าขาย" and the historic Recycling URL.
 * It reuses the app's existing sidebar/toolbar layout and renders a single
 * cart, rather than stacking an alternate cashier module over the ordinary POS.
 */
export async function RecyclingSalesContent({
  tenantId,branchId,deviceCode
}:{
  tenantId:string;branchId:string;deviceCode:string|null;
}) {
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();
  const db = getSupabaseServiceClient();
  const [products,branch,tenant,generalSaleEnabled] = await Promise.all([
    getRecyclingCatalog(tenantId,branchId),
    db.from("branches").select("name").eq("tenant_id",tenantId).eq("id",branchId).maybeSingle(),
    db.from("tenants").select("name,display_name").eq("id",tenantId).maybeSingle(),
    isAuthorizedCustomGeneralSaleTenant(tenantId)
  ]);
  if (branch.error || !branch.data || tenant.error || !tenant.data)
    throw new Error("recycling_sales_shop_scope_unavailable");
  return <RecyclingPosWorkspace
    products={products}
    branchName={branch.data.name ?? "สาขาที่เข้าสู่ระบบ"}
    storeName={tenant.data.display_name || tenant.data.name || "ร้านค้าของเก่า"}
    deviceCode={deviceCode}
    generalSaleEnabled={generalSaleEnabled}
    transactionWritesEnabled={process.env.RECYCLING_TRANSACTION_WRITES_ENABLED==="1"} />;
}
