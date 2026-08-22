import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type MoveBillPayload = {
  target_table_id: string;
  reason?: string;
};

type MoveBillRow = {
  order_id: string | null;
  from_table_id: string;
  to_table_id: string;
  table_session_id: string;
  session_status: string;
  moved: boolean;
};

function moveBillFailure(message: string) {
  const normalized = message.toUpperCase();
  if (normalized.includes("INVALID_TABLE_MOVE_SCOPE")) return fail("invalid_table_move_scope", "Table move scope is invalid.", 422);
  if (normalized.includes("SOURCE_BILL_NOT_FOUND")) return fail("source_bill_not_found", "No active bill on source table.", 409);
  if (normalized.includes("SOURCE_TABLE_NOT_FOUND")) return fail("source_table_not_found", "Source table was not found for this branch.", 404);
  if (normalized.includes("TARGET_TABLE_NOT_FOUND")) return fail("target_table_not_found", "Target table was not found for this branch.", 404);
  if (normalized.includes("TARGET_TABLE_OCCUPIED")) return fail("target_table_occupied", "Target table already has an active bill.", 409);
  if (normalized.includes("TABLE_MOVE_ORDER_NOT_FOUND")) return fail("table_move_order_not_found", "Active bill order was not found for this branch.", 404);
  return fail("table_move_failed", message || "Failed to move table.", 500);
}

export async function POST(req: Request, context: { params: Promise<{ tableId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:manage" });
    await requirePosApiFeature(auth, "table_management");
    const { tableId } = await context.params;
    if (!tableId) {
      return fail("invalid_table_id", "tableId is required.", 422);
    }

    const body = (await req.json()) as MoveBillPayload;
    const targetTableId = body.target_table_id?.trim();
    if (!targetTableId) {
      return fail("invalid_target_table_id", "target_table_id is required.", 422);
    }

    const reason = body.reason?.trim() || null;
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.rpc("move_table_bill_session_tx", {
      p_tenant_id: auth.tenantId!,
      p_branch_id: auth.branchId!,
      p_actor_user_id: auth.userId,
      p_source_table_id: tableId,
      p_target_table_id: targetTableId,
      p_reason: reason
    });

    if (error) {
      return moveBillFailure(error.message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as MoveBillRow | null;
    if (!row) {
      return fail("table_move_empty_result", "Table move returned no result.", 500);
    }

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: row.moved ? "table_changed" : "table_move_noop",
      targetTable: row.order_id ? "orders" : "table_bill_sessions",
      targetId: row.order_id ?? row.table_session_id,
      metadata: {
        from_table_id: row.from_table_id,
        to_table_id: row.to_table_id,
        table_session_id: row.table_session_id,
        session_status: row.session_status,
        reason
      }
    }).catch(() => undefined);

    invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    return ok({
      order_id: row.order_id,
      from_table_id: row.from_table_id,
      to_table_id: row.to_table_id,
      target_session_id: row.table_session_id,
      table_session_id: row.table_session_id,
      session_status: row.session_status,
      moved: row.moved
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("table_move_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}