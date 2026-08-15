import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import {
  DEFAULT_POS_SALES_MODE_ORDER,
  canManageBranchSalesModeOrder,
  normalizePosSalesModeOrder,
  type PosSalesMode
} from "@/lib/pos-sales-mode-preferences";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BranchSalesModeSettingsRow = {
  mode_order: unknown;
  updated_at: string | null;
};

export type BranchSalesModeOrderSettings = {
  order: PosSalesMode[];
  configured: boolean;
  can_manage: boolean;
  updated_at: string | null;
};

export type SaveBranchSalesModeOrderInput = {
  order?: unknown;
};

function requireBranchScope(auth: AuthContext) {
  const tenantId = String(auth.tenantId ?? "").trim();
  const branchId = String(auth.branchId ?? "").trim();
  if (!tenantId || !branchId) throw new Error("Branch scope is required for sales mode ordering.");
  return { tenantId, branchId };
}

function assertCanManageBranchSalesModeOrder(auth: AuthContext) {
  if (!canManageBranchSalesModeOrder(auth.branchRole, auth.platformRole)) {
    throw new Error("Only owner or manager can manage branch sales mode ordering.");
  }
}

function validateCompleteModeOrder(value: unknown): PosSalesMode[] {
  if (!Array.isArray(value)) {
    throw new Error("Sales mode order is required.");
  }

  const rawModes = value.map((entry) => String(entry ?? "").trim());
  const supported = new Set<string>(DEFAULT_POS_SALES_MODE_ORDER);
  if (
    rawModes.length !== DEFAULT_POS_SALES_MODE_ORDER.length ||
    new Set(rawModes).size !== DEFAULT_POS_SALES_MODE_ORDER.length ||
    rawModes.some((mode) => !supported.has(mode))
  ) {
    throw new Error("Sales mode order must contain every supported mode exactly once.");
  }

  return normalizePosSalesModeOrder(rawModes);
}

export async function loadBranchSalesModeOrderSettings(auth: AuthContext): Promise<BranchSalesModeOrderSettings> {
  const { tenantId, branchId } = requireBranchScope(auth);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_pos_sales_mode_settings")
    .select("mode_order,updated_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .maybeSingle<BranchSalesModeSettingsRow>();

  if (error) throw new Error(error.message);

  return {
    order: data ? normalizePosSalesModeOrder(data.mode_order) : [...DEFAULT_POS_SALES_MODE_ORDER],
    configured: Boolean(data),
    can_manage: canManageBranchSalesModeOrder(auth.branchRole, auth.platformRole),
    updated_at: data?.updated_at ?? null
  };
}

export async function saveBranchSalesModeOrderSettings(
  auth: AuthContext,
  input: SaveBranchSalesModeOrderInput
): Promise<BranchSalesModeOrderSettings> {
  assertCanManageBranchSalesModeOrder(auth);
  const { tenantId, branchId } = requireBranchScope(auth);
  const order = validateCompleteModeOrder(input.order);
  const supabase = getSupabaseServiceClient();

  const { data: before } = await supabase
    .from("branch_pos_sales_mode_settings")
    .select("mode_order,updated_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .maybeSingle<BranchSalesModeSettingsRow>();

  const { data, error } = await supabase
    .from("branch_pos_sales_mode_settings")
    .upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        mode_order: order,
        updated_by: auth.userId
      },
      { onConflict: "tenant_id,branch_id" }
    )
    .select("mode_order,updated_at")
    .single<BranchSalesModeSettingsRow>();

  if (error) throw new Error(error.message);

  await appendAuditLog({
    tenantId,
    branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole ?? "staff",
    action: "pos_branch_sales_mode_order_updated",
    targetTable: "branch_pos_sales_mode_settings",
    targetId: branchId,
    module: "pos_settings",
    entityType: "branch_sales_mode_order",
    entityId: branchId,
    beforeData: before ? { mode_order: normalizePosSalesModeOrder(before.mode_order) } : {},
    afterData: { mode_order: normalizePosSalesModeOrder(data.mode_order) },
    metadata: {
      source: "pos_mode_selector",
      scope: "branch"
    }
  });

  return {
    order: normalizePosSalesModeOrder(data.mode_order),
    configured: true,
    can_manage: true,
    updated_at: data.updated_at ?? null
  };
}
