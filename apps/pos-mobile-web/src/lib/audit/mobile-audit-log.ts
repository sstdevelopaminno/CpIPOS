import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import type { BranchRole, MobileScope } from "@/types/contracts";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type MobileAuditInput = {
  scope?: MobileScope | null;
  tenantId?: string | null;
  branchId?: string | null;
  actorUserId?: string | null;
  actorRole?: BranchRole | string | null;
  action: string;
  targetTable: string;
  targetId?: string | null;
  targetUserId?: string | null;
  module?: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  beforeData?: JsonObject;
  afterData?: JsonObject;
  deviceCode?: string | null;
  posSessionId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
};

const missingAuditColumns = new Set<string>();
const SOURCE_APP = "CpIPOS Mobile";

function normalizeJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function asJsonObject(value: Record<string, unknown> | undefined): JsonObject {
  return normalizeJsonObject(value ?? {});
}

function inferModule(targetTable: string, action: string) {
  if (["orders", "order_items", "payments", "table_bill_sessions"].includes(targetTable)) return "pos_sales";
  if (["products", "ingredients", "stock_movements"].includes(targetTable)) return "stock";
  if (targetTable === "shifts") return "shift";
  if (["mobile_members", "mobile_member_transactions", "mobile_member_settings"].includes(targetTable)) return "members";
  if (["pos_sessions", "pos_login_contexts"].includes(targetTable)) return "auth";
  return action.split("_")[0] || "mobile";
}

function buildRow(input: MobileAuditInput) {
  const scope = input.scope ?? null;
  const metadata: JsonObject = {
    ...asJsonObject(input.metadata),
    source_app: SOURCE_APP,
    source_channel: "mobile_web",
    device_code: input.deviceCode ?? scope?.deviceCode ?? null,
    device_name: scope?.deviceName ?? null,
    pos_session_id: input.posSessionId ?? scope?.sessionId ?? null,
  };
  const actorUserId = input.actorUserId ?? scope?.userId ?? null;
  const actorRole = String(input.actorRole ?? scope?.role ?? "staff");

  return {
    tenant_id: input.tenantId ?? scope?.tenantId ?? null,
    branch_id: input.branchId ?? scope?.branchId ?? null,
    actor_user_id: actorUserId,
    actor_role: actorRole,
    target_user_id: input.targetUserId ?? null,
    action: input.action,
    target_table: input.targetTable,
    target_id: input.targetId ?? null,
    metadata,
    user_id: actorUserId,
    role: actorRole,
    module: input.module ?? inferModule(input.targetTable, input.action),
    entity_type: input.entityType ?? input.targetTable,
    entity_id: input.entityId ?? input.targetId ?? null,
    before_data: input.beforeData ?? normalizeJsonObject(metadata.before_data),
    after_data: input.afterData ?? normalizeJsonObject(metadata.after_data),
    override_by_user_id: null,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    device_code: input.deviceCode ?? scope?.deviceCode ?? null,
    pos_session_id: input.posSessionId ?? scope?.sessionId ?? null,
  };
}

export async function appendMobileAuditLog(input: MobileAuditInput) {
  const row = buildRow(input);
  if (!row.tenant_id || !row.branch_id || !row.actor_user_id) return { inserted: false, skipped: "missing_scope" };

  let attemptRow: Record<string, unknown> = { ...row };
  for (const missing of missingAuditColumns) delete attemptRow[missing];

  try {
    const supabase = createServiceClient();
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const { error } = await supabase.from("audit_logs").insert(attemptRow);
      if (!error) return { inserted: true, action: row.action };

      const message = String(error.message ?? "");
      const missingColumn = message.match(/Could not find the '([^']+)' column of 'audit_logs'/i)?.[1]?.trim();
      if (!missingColumn || !(missingColumn in attemptRow)) throw new Error(message || "audit_log_insert_failed");

      missingAuditColumns.add(missingColumn);
      const next = { ...attemptRow };
      delete next[missingColumn];
      attemptRow = next;
    }
  } catch (error) {
    console.error("[mobile-audit] write failed", {
      action: row.action,
      target_table: row.target_table,
      target_id: row.target_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { inserted: false, action: row.action };
}