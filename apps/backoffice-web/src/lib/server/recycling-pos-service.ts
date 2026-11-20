import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type RecyclingUnit = "kg" | "khid" | "g" | "ton" | "piece";
export type RecyclingPriceBasis = "kg" | "piece";

export type RecyclingCatalogItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  imageUrl: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  quantityBase: number | null;
  priceBasis: RecyclingPriceBasis;
  active: boolean;
};

/**
 * A generic CUSTOM package never grants access by itself. Require precisely
 * one effective active/trial contract with an explicit IT recycling grant.
 * Do not use tenant name, browser flags, or public store code as authorization.
 */
export async function isAuthorizedRecyclingTenant(tenantId: string): Promise<boolean> {
  const db = getSupabaseServiceClient();
  const { data: contract, error } = await db.from("tenant_subscription_contracts")
    .select("package_id,status,ended_at,metadata")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  // The latest contract is authoritative. Never reactivate a previous trial
  // merely because it still exists after IT replaced it with an inactive plan.
  if (error || !contract || !["active", "trial"].includes(contract.status)) return false;

  const now = Date.now();
  if (contract.ended_at && (!Number.isFinite(Date.parse(contract.ended_at)) ||
      Date.parse(contract.ended_at) <= now)) return false;
  const metadata = contract.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const modes = (metadata as Record<string, unknown>).sales_modes;
  if (!modes || typeof modes !== "object" || Array.isArray(modes) ||
      (modes as Record<string, unknown>).recycling !== true) return false;
  const [plan, lifecycle, tenantStatus] = await Promise.all([
    db.from("subscription_packages").select("code").eq("id", contract.package_id).maybeSingle(),
    db.from("tenant_data_lifecycle")
      .select("access_locked,lifecycle_status,trial_expires_at,subscription_expires_at")
      .eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenants").select("is_active").eq("id", tenantId).maybeSingle()
  ]);
  if (plan.error || lifecycle.error || tenantStatus.error) return false;
  if (String(plan.data?.code ?? "").toLowerCase() !== "custom") return false;
  if (tenantStatus.data?.is_active !== true || !lifecycle.data || lifecycle.data.access_locked === true) return false;
  if (lifecycle.data.lifecycle_status === "trial" &&
      (!lifecycle.data.trial_expires_at ||
       !Number.isFinite(Date.parse(lifecycle.data.trial_expires_at)) ||
       Date.parse(lifecycle.data.trial_expires_at) <= now)) return false;
  if (lifecycle.data.lifecycle_status === "active" &&
      lifecycle.data.subscription_expires_at &&
      (!Number.isFinite(Date.parse(lifecycle.data.subscription_expires_at)) ||
       Date.parse(lifecycle.data.subscription_expires_at) <= now)) return false;
  if (lifecycle.data.lifecycle_status !== "trial" &&
      lifecycle.data.lifecycle_status !== "active") return false;
  return true;
}

/**
 * Catalog reads are tenant + branch scoped. The initial UI is deliberately
 * read-only: payments, receiving, inventory and finance postings must wait for
 * an audited recycling transaction implementation.
 */
export async function getRecyclingCatalog(tenantId: string, branchId: string): Promise<RecyclingCatalogItem[]> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("products")
    .select("id,sku,name,category,price,sell_unit,metadata,is_active")
    .eq("tenant_id", tenantId).eq("branch_id", branchId)
    .eq("is_active", true).is("deleted_at", null)
    .order("name", { ascending: true }).limit(1000);
  if (error) throw new Error("recycling_catalog_unavailable");

  // Do not show a fake zero balance before the additive recycling migration
  // is installed and verified. Gate the extra query to avoid repeated
  // PostgREST 404 log events (and unnecessary Vercel usage) during rollout.
  const quantityByProduct = new Map<string, number>();
  if (process.env.RECYCLING_STOCK_SCHEMA_READY === "1") {
    const balances = await db.from("recycling_stock_balances")
      .select("product_id,quantity_base")
      .eq("tenant_id", tenantId).eq("branch_id", branchId).limit(1000);
    if (balances.error) throw new Error("recycling_balance_query_failed");
    for (const row of balances.data ?? []) {
      quantityByProduct.set(String(row.product_id), Number(row.quantity_base));
    }
  }

  return (data ?? []).filter((product) => product.metadata && typeof product.metadata === "object" &&
    !Array.isArray(product.metadata) &&
    (product.metadata as Record<string, unknown>).business_mode === "recycling")
    .map((product): RecyclingCatalogItem => {
    const metadata = product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
      ? product.metadata as Record<string, unknown> : {};
    const buy = Number(metadata.recycling_buy_price);
    const sell = Number(product.price);
    const url = metadata.image_url;
    const unit = String(product.sell_unit ?? "").toLowerCase();
    const basis = metadata.recycling_price_basis === "piece" || ["piece", "ชิ้น", "ต้น"].includes(unit)
      ? "piece" : "kg";
    return {
      id: String(product.id),
      sku: String(product.sku ?? ""),
      name: String(product.name ?? ""),
      category: String(product.category ?? "ไม่ระบุประเภท"),
      imageUrl: typeof url === "string" && /^https:\/\//i.test(url) ? url : null,
      buyPrice: metadata.recycling_buy_price != null && Number.isFinite(buy) && buy >= 0 ? buy : null,
      sellPrice: Number.isFinite(sell) && sell >= 0 ? sell : null,
      quantityBase: process.env.RECYCLING_STOCK_SCHEMA_READY === "1"
        ? quantityByProduct.get(String(product.id)) ?? 0 : null,
      priceBasis: basis,
      active: Boolean(product.is_active)
    };
  });
}
