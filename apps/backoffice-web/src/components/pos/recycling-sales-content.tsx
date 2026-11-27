import {canManageRecyclingCashierDate,recyclingCashierDateEnabled,recyclingCashierDateReady} from "@/lib/server/recycling-cashier-date-service";
import { notFound } from "next/navigation";
import { RecyclingPosWorkspace } from "@/components/pos/recycling-pos-workspace";
import { getRecyclingCatalog, isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { loadProductMediaMap } from "@/lib/product-media";

/**
 * One authenticated screen used by "หน้าขาย" and the historic Recycling URL.
 * It reuses the app's existing sidebar/toolbar layout and renders a single
 * cart, rather than stacking an alternate cashier module over the ordinary POS.
 */
export async function RecyclingSalesContent({
  tenantId,branchId,deviceCode,operatorUserId
}:{
  tenantId:string;branchId:string;deviceCode:string|null;operatorUserId:string;
}) {
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();
  const db = getSupabaseServiceClient();
  const shiftQuery = db.from("shifts").select("status")
    .eq("tenant_id", tenantId).eq("branch_id",branchId)
    .eq("status","open").order("opened_at",{ascending:false}).limit(1);
  const [products,branch,tenant,operator,shift,generalSaleEnabled,printerProfiles] = await Promise.all([
    getRecyclingCatalog(tenantId,branchId),
    db.from("branches").select("name").eq("tenant_id",tenantId).eq("id",branchId).maybeSingle(),
    db.from("tenants").select("name,display_name,metadata").eq("id",tenantId).maybeSingle(),
    db.from("users_profiles").select("full_name").eq("id",operatorUserId).maybeSingle(),
    deviceCode ? shiftQuery.eq("device_code",deviceCode).maybeSingle() : shiftQuery.maybeSingle(),
    isAuthorizedCustomGeneralSaleTenant(tenantId,branchId).catch(() => false),
    // Fail closed on unavailable printer metadata: receipt printing still
    // works through the normal polling path, without changing any other store.
    db.from("printer_profiles").select("metadata").eq("tenant_id",tenantId)
      .eq("branch_id",branchId).eq("enabled",true)
  ]);
  if (branch.error || !branch.data || tenant.error || !tenant.data || operator.error || shift.error)
    throw new Error("recycling_sales_shop_scope_unavailable");
  const fastWindowsReceiptEnabled = Boolean(deviceCode && !printerProfiles.error &&
    (printerProfiles.data ?? []).some(row => {
      const meta = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string,unknown> : {};
      return meta.target_runtime === "windows_native" &&
        meta.windows_receipt_fast_wake === true &&
        meta.windows_device_code === deviceCode;
    }));
  // Match the stock manager's uploaded thumbnail, not the deprecated metadata URL.
  const media=await loadProductMediaMap({tenantId,branchId});
  const mediaByProduct:Record<string,string>={};
  for(const item of products){
    const asset=media.get(item.id);
    if(asset)mediaByProduct[item.id]=asset.thumbnail_url;
  }
  return <RecyclingPosWorkspace
    products={products}
    tenantId={tenantId} branchId={branchId}
    mediaByProduct={mediaByProduct}
    branchName={branch.data.name ?? "สาขาที่เข้าสู่ระบบ"}
    storeName={tenant.data.display_name || tenant.data.name || "ร้านค้าของเก่า"}
    deviceCode={deviceCode}
    sellerName={operator.data?.full_name?.trim() || "—"}
    shiftStatus={shift.data?.status ?? "ยังไม่เปิดกะ"}
    generalSaleEnabled={generalSaleEnabled}
    transactionWritesEnabled={process.env.RECYCLING_TRANSACTION_WRITES_ENABLED==="1"}
    fastWindowsReceiptEnabled={fastWindowsReceiptEnabled}
    cashierDateEnabled={recyclingCashierDateReady()&&recyclingCashierDateEnabled(tenant.data.metadata,branchId)&&await canManageRecyclingCashierDate(tenantId,branchId,operatorUserId)} />;
}
