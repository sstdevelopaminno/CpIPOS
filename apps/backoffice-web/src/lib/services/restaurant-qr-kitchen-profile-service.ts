import "server-only";

import { resolveProductProfile } from "@/lib/product-profile-policy";
import { resolveRestaurantQrKitchenFlags, type QrKitchenHardeningFlags } from "@/lib/restaurant-qr-profile";
import { readThroughRuntimeCache, invalidateRuntimeCacheByPrefix } from "@/lib/route-runtime-cache";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type Scope = { tenantId: string; branchId: string; tenantCode?: string | null; branchCode?: string | null };
const prefix = (scope: Scope) => `restaurant-qr-review:${scope.tenantId}:${scope.branchId}`;

export function invalidateRestaurantQrReviewCache(tenantId: string, branchId: string) {
  invalidateRuntimeCacheByPrefix(`restaurant-qr-review:${tenantId}:${branchId}`);
}

// Use the same effective review policy on QR submission, cashier polling, and settings UI.
// The old id-only flag check could never detect FG/RESTAURANT_QR profile codes.
export async function loadRestaurantQrKitchenFlagsForScope(scope: Scope): Promise<QrKitchenHardeningFlags> {
  if (!scope.tenantId || !scope.branchId) throw new Error("Tenant and branch are required.");
  const { value } = await readThroughRuntimeCache<QrKitchenHardeningFlags>({
    key: prefix(scope),
    ttlMs: 10_000,
    staleIfErrorMs: 20_000,
    loader: async () => {
      const client = getPrimarySupabaseServiceClient();
      const [tenant, branch, saved] = await Promise.all([
        client.from("tenants").select("code,metadata").eq("id", scope.tenantId).maybeSingle(),
        client.from("branches").select("code").eq("tenant_id", scope.tenantId).eq("id", scope.branchId).maybeSingle(),
        client.from("tenant_pos_notification_settings")
          .select("table_qr_cashier_review_required")
          .eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId).maybeSingle()
      ]);
      if (tenant.error) throw new Error(tenant.error.message);
      if (branch.error) throw new Error(branch.error.message);
      if (saved.error) throw new Error(saved.error.message);
      const tenantCode = String(tenant.data?.code ?? scope.tenantCode ?? "");
      const branchCode = String(branch.data?.code ?? scope.branchCode ?? "");
      const profile = resolveProductProfile({ tenantCode, tenantMetadata: tenant.data?.metadata });
      const defaultFlags = resolveRestaurantQrKitchenFlags({
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        tenantCode,
        branchCode,
        productProfile: profile
      });
      const enabled = typeof saved.data?.table_qr_cashier_review_required === "boolean"
        ? saved.data.table_qr_cashier_review_required
        : defaultFlags.qr_pos_review_required;
      return {
        qr_pos_review_required: enabled,
        global_qr_order_alert: enabled,
        kitchen_send_confirmation: enabled
      };
    }
  });
  return value;
}
