import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { invalidatePosSalesListCacheForScope, loadPosSalesListData } from "@/lib/services/pos-sales-list-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type SaleStatus = "open" | "paid" | "void";
type PaymentStatus = "unpaid" | "cash" | "bank_transfer";
type PaymentRow = { method: string | null; status: string | null };

function canManageSalesRecord(auth: { branchRole: string | null; platformRole: string }) {
  return auth.platformRole === "it_admin" || auth.branchRole === "owner" || auth.branchRole === "manager";
}

function deriveSaleStatus(status: string | null): SaleStatus {
  if (status === "completed") return "paid";
  if (status === "cancelled") return "void";
  return "open";
}

function normalizePaymentMethod(method: string | null | undefined): Exclude<PaymentStatus, "unpaid"> | null {
  const normalized = String(method ?? "").trim().toLowerCase();
  if (normalized === "cash") return "cash";
  if (
    normalized === "bank_transfer" ||
    normalized === "transfer" ||
    normalized.includes("bank") ||
    normalized.includes("transfer") ||
    normalized.includes("promptpay")
  ) {
    return "bank_transfer";
  }
  return null;
}

function derivePaymentStatus(rows: PaymentRow[]): PaymentStatus | "complex" {
  const paidRows = rows.filter((row) => row.status === "paid");
  if (paidRows.length === 0) return "unpaid";

  const methods = new Set(
    paidRows
      .map((row) => normalizePaymentMethod(row.method))
      .filter((method): method is Exclude<PaymentStatus, "unpaid"> => method !== null)
  );
  if (methods.size !== 1) return "complex";
  return Array.from(methods)[0];
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

    const supabase = getSupabaseServiceClient();
    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .select("id,branch_id,status,notes,metadata")
      .eq("tenant_id", auth.tenantId!)
      .eq("id", orderId)
      .maybeSingle<{ id: string; branch_id: string; status: string | null; notes: string | null; metadata: Record<string, unknown> | null }>();
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

    const { data: paymentRows, error: paymentError } = await supabase
      .from("payments")
      .select("method,status")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", orderRow.branch_id)
      .eq("order_id", orderId);
    if (paymentError) return fail("sales_record_payment_query_failed", paymentError.message, 500);

    const currentSaleStatus = deriveSaleStatus(orderRow.status);
    const currentPaymentStatus = derivePaymentStatus((paymentRows ?? []) as PaymentRow[]);
    if (currentPaymentStatus === "complex" || saleStatus !== currentSaleStatus || paymentStatus !== currentPaymentStatus) {
      return fail(
        "sales_record_financial_state_immutable",
        "Financial status cannot be rewritten from Sales List. Use the canonical POS payment, void, or refund workflow.",
        409
      );
    }

    const nowIso = new Date().toISOString();
    const nextMetadata = {
      ...(orderRow.metadata ?? {}),
      sales_record_last_edited_at: nowIso,
      sales_record_last_edited_by: auth.userId,
      sales_record_edit_approval_id: approvalId,
      sales_record_previous_status: orderRow.status ?? null,
      sales_record_financial_state_preserved: true
    };
    const { error: updateError } = await supabase
      .from("orders")
      .update({ notes, metadata: nextMetadata })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", orderRow.branch_id)
      .eq("id", orderId);
    if (updateError) return fail("sales_record_update_failed", updateError.message, 500);

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: orderRow.branch_id,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "sales_record_edited",
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        sale_status: saleStatus,
        payment_status: paymentStatus,
        approval_id: approvalId,
        notes_only: true,
        financial_state_preserved: true
      }
    });
    invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId!, branchId: orderRow.branch_id });
    return ok({ updated: true, financial_state_preserved: true });
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
        metadata: {
          ...(orderRow.metadata ?? {}),
          sales_list_deleted: true,
          sales_list_deleted_at: nowIso,
          sales_list_deleted_by: auth.userId,
          sales_record_delete_approval_id: approvalId,
          sales_record_previous_status: orderRow.status ?? null,
          sales_record_financial_state_preserved: true
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
      metadata: {
        soft_delete: true,
        hidden_only: true,
        financial_state_preserved: true,
        preserved_order_status: orderRow.status ?? null,
        approval_id: approvalId
      }
    });
    invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId!, branchId: orderRow.branch_id });
    return ok({ deleted: true, hidden_only: true, financial_state_preserved: true });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("sales_record_delete_failed", error instanceof Error ? error.message : "Failed to delete sales record.", 400);
  }
}
