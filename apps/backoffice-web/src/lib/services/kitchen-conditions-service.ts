import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export type KitchenConditionsPolicy = {
  branch_id: string;
  lock_confirmed_items_on_pos: boolean;
};

export async function loadKitchenConditionsForScope(input: {
  tenantId: string;
  branchId: string;
}): Promise<KitchenConditionsPolicy> {
  if (!input.tenantId || !input.branchId) throw new Error("Tenant and branch scope are required.");
  const { data, error } = await getPrimarySupabaseServiceClient()
    .from("tenant_pos_notification_settings")
    .select("kitchen_confirmed_pos_delete_lock_enabled")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId)
    .maybeSingle<{ kitchen_confirmed_pos_delete_lock_enabled: boolean | null }>();

  // Never silently disable the lock when the authoritative settings lookup fails.
  if (error) throw new Error("kitchen_conditions_query_failed:" + error.message);
  return {
    branch_id: input.branchId,
    lock_confirmed_items_on_pos: data?.kitchen_confirmed_pos_delete_lock_enabled !== false
  };
}

export async function saveKitchenConditionsPolicy(
  auth: AuthContext,
  enabled: boolean
): Promise<KitchenConditionsPolicy> {
  if (!auth.tenantId || !auth.branchId) throw new Error("Tenant and branch scope are required.");
  if (auth.platformRole !== "it_admin" && auth.branchRole !== "owner" && auth.branchRole !== "manager") {
    throw new Error("Only owner or manager can edit kitchen conditions.");
  }
  if (typeof enabled !== "boolean") throw new Error("Invalid kitchen conditions value.");

  const tenantId = auth.tenantId;
  const branchId = auth.branchId;
  const previous = await loadKitchenConditionsForScope({ tenantId, branchId });
  const { error } = await getPrimarySupabaseServiceClient()
    .from("tenant_pos_notification_settings")
    .upsert({
      tenant_id: tenantId,
      branch_id: branchId,
      kitchen_confirmed_pos_delete_lock_enabled: enabled,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId
    }, { onConflict: "tenant_id,branch_id" });
  if (error) throw new Error("kitchen_conditions_save_failed:" + error.message);

  const policy = await loadKitchenConditionsForScope({ tenantId, branchId });
  void appendAuditLog({
    tenantId,
    branchId,
    actorUserId: auth.userId,
    actorRole: auth.platformRole === "it_admin" ? "it_admin" : auth.branchRole ?? "staff",
    action: "kitchen_confirmed_pos_delete_lock_updated",
    targetTable: "tenant_pos_notification_settings",
    entityId: tenantId + ":" + branchId,
    module: "settings",
    metadata: { before: previous.lock_confirmed_items_on_pos, after: policy.lock_confirmed_items_on_pos }
  });
  return policy;
}
