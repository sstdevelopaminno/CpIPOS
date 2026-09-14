import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export type TableQrPolicyOverride = "inherit" | "force_on" | "force_off";

export type TableQrAutomationPolicy = {
  branch_id: string;
  store: {
    popup_enabled: boolean;
    kitchen_auto_send_enabled: boolean;
    kitchen_auto_print_enabled: boolean;
  };
  override: {
    popup: TableQrPolicyOverride;
    kitchen_auto_send: TableQrPolicyOverride;
    kitchen_auto_print: TableQrPolicyOverride;
  };
  effective: {
    popup_enabled: boolean;
    kitchen_auto_send_enabled: boolean;
    kitchen_auto_print_enabled: boolean;
  };
  forced_by_it: {
    popup: boolean;
    kitchen_auto_send: boolean;
    kitchen_auto_print: boolean;
  };
};

type SettingsRow = {
  table_qr_popup_enabled?: boolean | null;
  table_qr_popup_store_enabled?: boolean | null;
  table_qr_kitchen_auto_send_enabled?: boolean | null;
  table_qr_kitchen_auto_print_enabled?: boolean | null;
  table_qr_popup_override?: string | null;
  table_qr_kitchen_auto_send_override?: string | null;
  table_qr_kitchen_auto_print_override?: string | null;
};

export type SaveStoreTableQrAutomationPolicyInput = {
  branch_id?: string;
  popup_enabled?: boolean;
  kitchen_auto_send_enabled?: boolean;
  kitchen_auto_print_enabled?: boolean;
};

export type SaveItTableQrAutomationOverridesInput = {
  tenant_id: string;
  branch_id: string;
  popup_override: TableQrPolicyOverride;
  kitchen_auto_send_override: TableQrPolicyOverride;
  kitchen_auto_print_override: TableQrPolicyOverride;
};

function normalizeOverride(value: unknown): TableQrPolicyOverride {
  return value === "force_on" || value === "force_off" ? value : "inherit";
}

export function resolveTableQrOverride(base: boolean, override: TableQrPolicyOverride): boolean {
  if (override === "force_on") return true;
  if (override === "force_off") return false;
  return base;
}

function assertBranchId(auth: AuthContext, requestedBranchId?: string): string {
  const branchId = String(requestedBranchId ?? auth.branchId ?? "").trim();
  if (!auth.tenantId || !branchId) {
    throw new Error("Tenant and branch are required.");
  }
  if (auth.platformRole !== "it_admin" && auth.branchId && branchId !== auth.branchId) {
    throw new Error("Branch scope mismatch.");
  }
  return branchId;
}

function canManageStorePolicy(auth: AuthContext): boolean {
  return auth.platformRole === "it_admin" || auth.branchRole === "owner" || auth.branchRole === "manager";
}

function toPolicy(branchId: string, row: SettingsRow | null): TableQrAutomationPolicy {
  const storePopup = row?.table_qr_popup_store_enabled ?? row?.table_qr_popup_enabled ?? true;
  const storeSend = row?.table_qr_kitchen_auto_send_enabled ?? true;
  const storePrint = row?.table_qr_kitchen_auto_print_enabled ?? true;
  const popupOverride = normalizeOverride(row?.table_qr_popup_override);
  const sendOverride = normalizeOverride(row?.table_qr_kitchen_auto_send_override);
  const printOverride = normalizeOverride(row?.table_qr_kitchen_auto_print_override);

  return {
    branch_id: branchId,
    store: {
      popup_enabled: storePopup,
      kitchen_auto_send_enabled: storeSend,
      kitchen_auto_print_enabled: storePrint
    },
    override: {
      popup: popupOverride,
      kitchen_auto_send: sendOverride,
      kitchen_auto_print: printOverride
    },
    effective: {
      popup_enabled: resolveTableQrOverride(storePopup, popupOverride),
      kitchen_auto_send_enabled: resolveTableQrOverride(storeSend, sendOverride),
      kitchen_auto_print_enabled: resolveTableQrOverride(storePrint, printOverride)
    },
    forced_by_it: {
      popup: popupOverride !== "inherit",
      kitchen_auto_send: sendOverride !== "inherit",
      kitchen_auto_print: printOverride !== "inherit"
    }
  };
}

async function readSettingsRow(tenantId: string, branchId: string): Promise<SettingsRow | null> {
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_pos_notification_settings")
    .select(
      "table_qr_popup_enabled,table_qr_popup_store_enabled,table_qr_kitchen_auto_send_enabled,table_qr_kitchen_auto_print_enabled,table_qr_popup_override,table_qr_kitchen_auto_send_override,table_qr_kitchen_auto_print_override"
    )
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .maybeSingle<SettingsRow>();

  if (error) throw new Error(`table_qr_automation_policy_read_failed:${error.message}`);
  return data ?? null;
}

export async function loadTableQrAutomationPolicy(
  auth: AuthContext,
  requestedBranchId?: string
): Promise<TableQrAutomationPolicy> {
  const branchId = assertBranchId(auth, requestedBranchId);
  const row = await readSettingsRow(String(auth.tenantId), branchId);
  return toPolicy(branchId, row);
}

export async function loadTableQrAutomationPolicyForScope(input: {
  tenantId: string;
  branchId: string;
}): Promise<TableQrAutomationPolicy> {
  const tenantId = String(input.tenantId ?? "").trim();
  const branchId = String(input.branchId ?? "").trim();
  if (!tenantId || !branchId) throw new Error("Tenant and branch are required.");
  const row = await readSettingsRow(tenantId, branchId);
  return toPolicy(branchId, row);
}

export async function saveStoreTableQrAutomationPolicy(
  auth: AuthContext,
  input: SaveStoreTableQrAutomationPolicyInput
): Promise<TableQrAutomationPolicy> {
  if (!canManageStorePolicy(auth)) {
    throw new Error("Only owner or manager can update order and kitchen settings.");
  }
  const branchId = assertBranchId(auth, input.branch_id);
  const tenantId = String(auth.tenantId);
  const current = toPolicy(branchId, await readSettingsRow(tenantId, branchId));

  const nextStorePopup = typeof input.popup_enabled === "boolean" ? input.popup_enabled : current.store.popup_enabled;
  const nextStoreSend =
    typeof input.kitchen_auto_send_enabled === "boolean"
      ? input.kitchen_auto_send_enabled
      : current.store.kitchen_auto_send_enabled;
  const nextStorePrint =
    typeof input.kitchen_auto_print_enabled === "boolean"
      ? input.kitchen_auto_print_enabled
      : current.store.kitchen_auto_print_enabled;

  const nextEffectivePopup = resolveTableQrOverride(nextStorePopup, current.override.popup);
  const nowIso = new Date().toISOString();
  const supabase = getPrimarySupabaseServiceClient();
  const { error } = await supabase.from("tenant_pos_notification_settings").upsert(
    {
      tenant_id: tenantId,
      branch_id: branchId,
      table_qr_popup_store_enabled: nextStorePopup,
      table_qr_popup_enabled: nextEffectivePopup,
      table_qr_kitchen_auto_send_enabled: nextStoreSend,
      table_qr_kitchen_auto_print_enabled: nextStorePrint,
      updated_at: nowIso,
      updated_by: auth.userId
    },
    { onConflict: "tenant_id,branch_id" }
  );
  if (error) throw new Error(`table_qr_automation_policy_save_failed:${error.message}`);

  const next = await loadTableQrAutomationPolicy(auth, branchId);
  await appendAuditLog({
    tenantId,
    branchId,
    actorUserId: auth.userId,
    actorRole: auth.platformRole === "it_admin" ? "it_admin" : auth.branchRole ?? "staff",
    action: "table_qr_automation_policy_updated",
    targetTable: "tenant_pos_notification_settings",
    targetId: `${tenantId}:${branchId}`,
    module: "settings",
    metadata: { before: current, after: next }
  });
  return next;
}

export async function saveItTableQrAutomationOverrides(
  auth: AuthContext,
  input: SaveItTableQrAutomationOverridesInput
): Promise<TableQrAutomationPolicy> {
  if (auth.platformRole !== "it_admin") throw new Error("Only IT admin can update automation overrides.");
  const tenantId = String(input.tenant_id ?? "").trim();
  const branchId = String(input.branch_id ?? "").trim();
  if (!tenantId || !branchId) throw new Error("tenant_id and branch_id are required.");

  const beforeRow = await readSettingsRow(tenantId, branchId);
  const before = toPolicy(branchId, beforeRow);
  const popupOverride = normalizeOverride(input.popup_override);
  const sendOverride = normalizeOverride(input.kitchen_auto_send_override);
  const printOverride = normalizeOverride(input.kitchen_auto_print_override);
  const effectivePopup = resolveTableQrOverride(before.store.popup_enabled, popupOverride);
  const nowIso = new Date().toISOString();
  const supabase = getPrimarySupabaseServiceClient();
  const { error } = await supabase.from("tenant_pos_notification_settings").upsert(
    {
      tenant_id: tenantId,
      branch_id: branchId,
      table_qr_popup_store_enabled: before.store.popup_enabled,
      table_qr_popup_enabled: effectivePopup,
      table_qr_kitchen_auto_send_enabled: before.store.kitchen_auto_send_enabled,
      table_qr_kitchen_auto_print_enabled: before.store.kitchen_auto_print_enabled,
      table_qr_popup_override: popupOverride,
      table_qr_kitchen_auto_send_override: sendOverride,
      table_qr_kitchen_auto_print_override: printOverride,
      updated_at: nowIso,
      updated_by: auth.userId
    },
    { onConflict: "tenant_id,branch_id" }
  );
  if (error) throw new Error(`table_qr_automation_override_save_failed:${error.message}`);

  const after = toPolicy(branchId, await readSettingsRow(tenantId, branchId));
  await appendAuditLog({
    tenantId,
    branchId,
    actorUserId: auth.userId,
    actorRole: "it_admin",
    action: "table_qr_automation_override_updated",
    targetTable: "tenant_pos_notification_settings",
    targetId: `${tenantId}:${branchId}`,
    module: "it_admin",
    metadata: { before, after }
  });
  return after;
}
