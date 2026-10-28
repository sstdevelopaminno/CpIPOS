import "server-only";

import { FeatureGateError } from "@/lib/feature-gate";
import { isCustomPosMenuVisible } from "@/lib/pos-menu-policy";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/**
 * A precise, tenant-scoped IT opt-in for the existing CUSTOM Optical 'More' pages.
 * Do not grant advanced_sales_reports or receipt_reprint_history globally:
 * permission to view one page must not unlock other advanced report APIs.
 */
export const OPTICAL_MORE_FEATURES = {
  "more.sales_summary": { route: "/preview/pos/sales-summary", feature: "advanced_sales_reports" },
  "more.receipts": { route: "/preview/pos/receipts", feature: "receipt_reprint_history" },
  "more.product_sales": { route: "/preview/pos/product-sales", feature: "advanced_sales_reports" }
} as const;

export type OpticalMoreMenuKey = keyof typeof OPTICAL_MORE_FEATURES;

/** Returns false for ordinary packages; CUSTOM Optical must have explicit IT opt-in. */
export async function authorizeOpticalMoreMenu(
  tenantId: string, branchId: string | null, menuKey: OpticalMoreMenuKey
): Promise<boolean> {
  if (!await requireOpticalRetailEntitlement(tenantId)) return false;

  const policy = await getTenantPosMenuOverrides(tenantId);
  if (!isCustomPosMenuVisible(menuKey, policy, true)) {
    throw new FeatureGateError("optical_menu_not_enabled", "This Optical menu has not been enabled by IT.", 403);
  }

  // Explicit feature denial is stronger than an IT navigation opt-in.
  const admin = getSupabaseServiceClient();
  let query = admin.from("tenant_feature_subscriptions")
    .select("branch_id,is_enabled")
    .eq("tenant_id", tenantId)
    .eq("feature_code", OPTICAL_MORE_FEATURES[menuKey].feature);
  query = branchId ? query.or(`branch_id.is.null,branch_id.eq.${branchId}`) : query.is("branch_id", null);
  const { data, error } = await query;
  if (error) throw new FeatureGateError("optical_feature_policy_unavailable", error.message, 503);
  if (data?.some(row => row.is_enabled === false)) {
    throw new FeatureGateError("optical_feature_explicitly_denied", "This feature was explicitly disabled for this store or branch.", 403);
  }
  return true;
}
