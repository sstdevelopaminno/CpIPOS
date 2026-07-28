import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { invalidatePosSalesListCacheForScope, loadPosSalesListData } from "@/lib/services/pos-sales-list-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type SaleStatus = "open" | "paid" | "void";
type PaymentStatus = "unpaid" | "cash" | "bank_transfer";

function canManageSalesRecord(auth: { branchRole: string | null; platformRole: string }) {
  return auth.platformRole === "it_admin" || auth.branchRole === "owner" || auth.branchRole === "manager";
}

function toOrderStatus(status: SaleStatus) {
  if (status === "paid") return "completed";
  if (status === "void") return "cancelled";
  return "queued";
}

async function verifyApproval(args: {
  approvalId?: string | null;
  action: "sales_record_edit" | "sales_record_delete";
  tenantId: string;
  targetId: string;
  itAdminBypass: boolean;
}) {
  if (args.itAdminBypass) return null;
  const approvalId = String(args.approvalId ?? "").trim();
  if (!approvalId) return fail("sales_record_approval_required", "PIN approval is required.", 403);
  const { data, error } = await getSupabaseServiceClient()
    .from("manager_pin_approvals")
    .select("id,action,target_table,target_id,expires_at")
    .eq("tenant_id", args.tenantId)
    .eq("id", approvalId)
    .maybeSingle<{ id: string; action: string; target_table: string; target_id: string; expires_at: string | null }>();
  if (error) return fail("sales_record_approval_query_failed", error.message, 500);
  if (!data) return fail("sales_record_approval_invalid", "PIN approval was not found.", 403);
  if (data.action !== args.action || data.target_table !== "orders" || data.target_id !== args.targetId) {
    return fail("sales_record_approval_mismatch", "PIN approval does not match this sales record.", 403);
  }
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return fail("sales_record_approval_expired", "PIN approval has expired.", 403);
  }
  return null;
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:list:view" });
    await requirePosApiFeature(auth, "advanced_sales_reports");
    const payload = await loadPosSalesListData({
      userId: auth.userId,
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      branchRole: auth.branchRole,
      platformRole: auth.platformRole
    });
    return ok(payload);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("sales_list_fetch_failed", error instanceof Error ? error.message : "Failed to fetch sales list.", 401);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:list:view" });
    await requirePosApiFeature(auth, "advanced_sales_reports");
    if (!canManageSalesRecord(auth)) return fail("forbidden_role", "Only owner, manager, or IT admin can edit sales records.", 403);

    const body = (await request.json().catch(() => null)) as {
      order_id?: string;
      approval_id?: string | null;
      sale_status?: SaleStatus;
      payment_status?: PaymentStatus;
      notes?: string | null;
    } | null;
    const orderId = String(body?.order_id ?? "").trim();
    const saleStatus = body?.sale_status;
    const paymentStatus = body?.payment_status;
    const approvalId = body?.approval_id ?? null;
    const notes = body?.notes ?? null;
    if (!orderId || (saleStatus !== "open" && saleStatus !== "paid" && saleStatus !== "void")) {
      return fail("invalid_sales_record_edit", "Invalid sales record edit payload.", 422);
    }
    if (paymentStatus !== "unpaid" && paymentStatus !== "cash" && paymentStatus !== "bank_transfer") {
      return fail("invalid_sales_record_payment", "Invalid payment status.", 422);
    }
    if (saleStatus === "paid" && paymentStatus === "unpaid") {
      return fail("invalid_sales_record_payment", "Paid sales records require a payment method.", 422);
    }

    const supabase = getSupabaseServiceClient();
    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .select("id,branch_id,total_amount,status,notes,metadata")
      .eq("tenant_id", auth.tenantId!)
      .eq("id", orderId)
      .maybeSingle<{ id: string; branch_id: string; total_amount: number | null; status: string | null; notes: string | null; metadata: Record<string, unknown> | null }>();
    if (orderError) return fail("sales_record_query_failed", orderError.message, 500);
    if (!orderRow) return fail("sales_record_not_found", "Sales record was not found.", 404);

    const approvalError = await verifyApproval({
      approvalId,
      action: "sales_record_edit",
      tenantId: auth.tenantId!,
      targetId: orderId,
      itAdminBypass: auth.platformRole === "it_admin"
    });
    if (approvalError) return approvalError;

    const nowIso = new Date().toISOString();
    const nextMetadata = {
      ...(orderRow.metadata ?? {}),
      sales_record_last_edited_at: nowIso,
      sales_record_last_edited_by: auth.userId,
      sales_record_edit_approval_id: approvalId,
      sales_record_previous_status: orderRow.status ?? null
    };
    const updatePayload: Record<string, unknown> = {
      status: toOrderStatus(saleStatus),
      notes,
      metadata: nextMetadata
    };
    if (saleStatus === "paid") {
      updatePayload.payment_completed_at = nowIso;
      updatePayload.payment_completed_by = auth.userId;
      updatePayload.cash_received = paymentStatus === "cash" ? Number(orderRow.total_amount ?? 0) : null;
      updatePayload.change_amount = paymentStatus === "cash" ? 0 : null;
    } else {
      updatePayload.payment_completed_at = null;
      updatePayload.payment_completed_by = null;
      updatePayload.cash_received = null;
      updatePayload.change_amount = null;
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", orderRow.branch_id)
      .eq("id", orderId);
    if (updateError) return fail("sales_record_update_failed", updateError.message, 500);

    const paymentDelete = await supabase.from("payments").delete().eq("tenant_id", auth.tenantId!).eq("branch_id", orderRow.branch_id).eq("order_id", orderId);
    if (paymentDelete.error) return fail("sales_record_payment_update_failed", paymentDelete.error.message, 500);
    if (saleStatus === "paid" && paymentStatus !== "unpaid") {
      const paymentInsert = await supabase.from("payments").insert({
        tenant_id: auth.tenantId,
        branch_id: orderRow.branch_id,
        order_id: orderId,
        method: paymentStatus,
        amount: Number(orderRow.total_amount ?? 0),
        received_by: auth.userId,
        received_at: nowIso
      });
      if (paymentInsert.error) return fail("sales_record_payment_update_failed", paymentInsert.error.message, 500);
    }

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: orderRow.branch_id,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "sales_record_edited",
      targetTable: "orders",
      targetId: orderId,
      metadata: { sale_status: saleStatus, payment_status: paymentStatus, approval_id: approvalId }
    });
    invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId!, branchId: orderRow.branch_id });
    return ok({ updated: true });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("sales_record_edit_failed", error instanceof Error ? error.message : "Failed to edit sales record.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:list:view" });
    await requirePosApiFeature(auth, "advanced_sales_reports");
    if (!canManageSalesRecord(auth)) return fail("forbidden_role", "Only owner, manager, or IT admin can delete sales records.", 403);

    const body = (await request.json().catch(() => null)) as { order_id?: string; approval_id?: string | null } | null;
    const orderId = String(body?.order_id ?? "").trim();
    const approvalId = body?.approval_id ?? null;
    if (!orderId) return fail("invalid_sales_record_delete", "order_id is required.", 422);

    const supabase = getSupabaseServiceClient();
    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .select("id,branch_id,status,metadata")
      .eq("tenant_id", auth.tenantId!)
      .eq("id", orderId)
      .maybeSingle<{ id: string; branch_id: string; status: string | null; metadata: Record<string, unknown> | null }>();
    if (orderError) return fail("sales_record_query_failed", orderError.message, 500);
    if (!orderRow) return fail("sales_record_not_found", "Sales record was not found.", 404);

    const approvalError = await verifyApproval({
      approvalId,
      action: "sales_record_delete",
      tenantId: auth.tenantId!,
      targetId: orderId,
      itAdminBypass: auth.platformRole === "it_admin"
    });
    if (approvalError) return approvalError;

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_by: auth.userId,
        cancelled_reason: "ลบจากหน้ารายการขาย",
        metadata: {
          ...(orderRow.metadata ?? {}),
          sales_list_deleted: true,
          sales_list_deleted_at: nowIso,
          sales_list_deleted_by: auth.userId,
          sales_record_delete_approval_id: approvalId,
          sales_record_previous_status: orderRow.status ?? null
        }
      })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", orderRow.branch_id)
      .eq("id", orderId);
    if (updateError) return fail("sales_record_delete_failed", updateError.message, 500);

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: orderRow.branch_id,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "sales_record_deleted",
      targetTable: "orders",
      targetId: orderId,
      metadata: { soft_delete: true, approval_id: approvalId }
    });
    invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId!, branchId: orderRow.branch_id });
    return ok({ deleted: true });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("sales_record_delete_failed", error instanceof Error ? error.message : "Failed to delete sales record.", 400);
  }
}
