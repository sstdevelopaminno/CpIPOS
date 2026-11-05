import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { tableShapes, tableStatuses } from "@/lib/table-management";
import { resolveTableBranchScope } from "@/lib/table-branch-scope";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type TableUpdatePayload = {
  branch_id?: string;
  manager_approval_id?: string | null;
  zone_id?: string | null;
  table_code?: string;
  table_name?: string | null;
  capacity?: number;
  status?: string;
  shape?: string;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
};

async function verifyManagerTableApproval(args: {
  approvalId: string;
  tenantId: string;
  branchId: string;
  tableId: string;
}) {
  const { approvalId, tenantId, branchId, tableId } = args;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("manager_pin_approvals")
    .select("id,action,target_table,target_id,expires_at")
    .eq("id", approvalId)
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .maybeSingle<{
      id: string;
      action: string;
      target_table: string;
      target_id: string;
      expires_at: string | null;
    }>();

  if (error) {
    return fail("table_approval_query_failed", error.message, 500);
  }
  if (!data) {
    return fail("table_approval_invalid", "Manager PIN approval was not found.", 403);
  }
  if (data.action !== "table_move_bill") {
    return fail("table_approval_action_mismatch", "Manager PIN approval action does not match table operation.", 403);
  }
  if (data.target_table !== "dining_tables" || data.target_id !== tableId) {
    return fail("table_approval_target_mismatch", "Manager PIN approval target does not match this table.", 403);
  }
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return fail("table_approval_expired", "Manager PIN approval has expired.", 403);
  }
  return null;
}

export async function PATCH(req: Request, context: { params: Promise<{ tableId: string }> }) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "table_management");
    const { tableId } = await context.params;
    if (!tableId) {
      return fail("invalid_table_id", "tableId is required.", 422);
    }

    const body = (await req.json()) as TableUpdatePayload;
    const supabase = getSupabaseServiceClient();
    const branchScope = await resolveTableBranchScope({
      auth,
      requestedBranchId: body.branch_id,
      requireManage: true,
      supabaseClient: supabase
    });
    if (!branchScope.ok) {
      return fail(branchScope.code, branchScope.message, branchScope.status);
    }
    const targetBranchId = branchScope.targetBranchId!;
    const targetRole = branchScope.branches.find((branch) => branch.id === targetBranchId)?.role ?? auth.branchRole;

    if (targetRole === "manager") {
      const approvalId = String(body.manager_approval_id ?? "").trim();
      if (!approvalId) {
        return fail("table_approval_required", "Manager PIN approval is required to edit table.", 422);
      }
      const approvalError = await verifyManagerTableApproval({
        approvalId,
        tenantId: auth.tenantId!,
        branchId: targetBranchId,
        tableId
      });
      if (approvalError) {
        return approvalError;
      }
    }
    const updatePayload: Record<string, unknown> = {};

    if (body.table_code !== undefined) {
      const tableCode = String(body.table_code ?? "").trim();
      if (!tableCode) {
        return fail("invalid_table_code", "Table number is required.", 422);
      }
      if (tableCode.length > 64) {
        return fail("invalid_table_code", "Table number must be 64 characters or fewer.", 422);
      }
      const { data: duplicateTable, error: duplicateTableError } = await supabase
        .from("dining_tables")
        .select("id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", targetBranchId)
        .eq("table_code", tableCode)
        .neq("id", tableId)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (duplicateTableError) {
        return fail("table_code_lookup_failed", duplicateTableError.message, 500);
      }
      if (duplicateTable) {
        return fail("table_code_conflict", "Table number already exists in this branch.", 409);
      }
      updatePayload.table_code = tableCode;
    }

    if (body.zone_id !== undefined) updatePayload.zone_id = body.zone_id;
    if (body.table_name !== undefined) updatePayload.table_name = body.table_name?.trim() || null;
    if (typeof body.capacity === "number") updatePayload.capacity = Math.max(1, body.capacity);
    if (typeof body.status === "string" && tableStatuses.includes(body.status as (typeof tableStatuses)[number])) {
      updatePayload.status = body.status;
    }
    if (typeof body.shape === "string" && tableShapes.includes(body.shape as (typeof tableShapes)[number])) {
      updatePayload.shape = body.shape;
    }
    if (typeof body.position_x === "number") updatePayload.position_x = body.position_x;
    if (typeof body.position_y === "number") updatePayload.position_y = body.position_y;
    if (typeof body.width === "number") updatePayload.width = Math.max(40, body.width);
    if (typeof body.height === "number") updatePayload.height = Math.max(40, body.height);
    if (typeof body.rotation === "number") updatePayload.rotation = body.rotation;
    if (typeof body.is_active === "boolean") updatePayload.is_active = body.is_active;
    if (body.metadata && typeof body.metadata === "object") updatePayload.metadata = body.metadata;

    if (Object.keys(updatePayload).length === 0) {
      return fail("invalid_payload", "No updatable fields provided.", 422);
    }

    if (body.zone_id !== undefined && body.zone_id !== null) {
      const { data: zone, error: zoneError } = await supabase
        .from("table_zones")
        .select("id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", targetBranchId)
        .eq("id", body.zone_id)
        .maybeSingle();
      if (zoneError) {
        return fail("zone_lookup_failed", zoneError.message, 500);
      }
      if (!zone) {
        return fail("invalid_zone_id", "zone_id is not available in current branch.", 422);
      }
    }

    const { data, error } = await supabase
      .from("dining_tables")
      .update(updatePayload)
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", targetBranchId)
      .eq("id", tableId)
      .select(
        "id,tenant_id,branch_id,zone_id,table_code,table_name,capacity,status,shape,position_x,position_y,width,height,rotation,is_active,metadata,created_at,updated_at"
      )
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return fail("table_code_conflict", "Table number already exists in this branch.", 409);
      }
      return fail("table_update_failed", error.message, 500);
    }
    if (!data) {
      return fail("table_not_found", "Table not found in current branch.", 404);
    }

    await appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: targetBranchId,
      actorUserId: auth.userId,
      actorRole: targetRole!,
      action: "table_updated",
      targetTable: "dining_tables",
      targetId: data.id,
      metadata: updatePayload
    });

    return ok(data);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ tableId: string }> }) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "table_management");
    const { tableId } = await context.params;
    if (!tableId) {
      return fail("invalid_table_id", "tableId is required.", 422);
    }
    const url = new URL(_req.url);
    const supabase = getSupabaseServiceClient();
    const branchScope = await resolveTableBranchScope({
      auth,
      requestedBranchId: url.searchParams.get("branch_id"),
      requireManage: true,
      supabaseClient: supabase
    });
    if (!branchScope.ok) {
      return fail(branchScope.code, branchScope.message, branchScope.status);
    }
    const targetBranchId = branchScope.targetBranchId!;
    const targetRole = branchScope.branches.find((branch) => branch.id === targetBranchId)?.role ?? auth.branchRole;
    if (targetRole === "manager") {
      const approvalId = String(url.searchParams.get("approval_id") ?? "").trim();
      if (!approvalId) {
        return fail("table_approval_required", "Manager PIN approval is required to delete table.", 422);
      }
      const approvalError = await verifyManagerTableApproval({
        approvalId,
        tenantId: auth.tenantId!,
        branchId: targetBranchId,
        tableId
      });
      if (approvalError) {
        return approvalError;
      }
    }

    // Force delete behavior: detach table from all orders first, then delete table.
    // This avoids FK constraints from historical/current orders.
    const { error: detachOrderError } = await supabase
      .from("orders")
      .update({ table_id: null })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", targetBranchId)
      .eq("table_id", tableId);

    if (detachOrderError) {
      return fail("table_order_detach_failed", detachOrderError.message, 500);
    }

    const { data, error } = await supabase
      .from("dining_tables")
      .delete()
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", targetBranchId)
      .eq("id", tableId)
      .select("id,table_code")
      .maybeSingle();

    if (error) {
      return fail("table_delete_failed", error.message, 500);
    }
    if (!data) {
      return fail("table_not_found", "Table not found in current branch.", 404);
    }

    await appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: targetBranchId,
      actorUserId: auth.userId,
      actorRole: targetRole!,
      action: "table_deleted",
      targetTable: "dining_tables",
      targetId: data.id,
      metadata: {
        table_code: data.table_code
      }
    });

    return ok({ id: data.id, deleted: true });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
