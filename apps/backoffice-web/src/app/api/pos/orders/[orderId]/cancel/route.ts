import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { dispatchOrderToKitchen } from "@/lib/services/kitchen-routing-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

export async function POST(req: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sale:create" });
    const supabase = getSupabaseServiceClient();
    const { orderId } = await context.params;
    const body = (await req.json()) as {
      reason?: string;
      cancellation_approval_id?: string;
    };

    if (!orderId) {
      return fail("invalid_order_id", "orderId is required.", 422);
    }

    const cancellationApprovalId = body.cancellation_approval_id?.trim();
    if (!cancellationApprovalId) {
      return fail("cancellation_approval_required", "An authorized PIN approval is required before cancelling bill.", 422);
    }

    const { data: approvalRow, error: approvalError } = await supabase
      .from("manager_pin_approvals")
      .select("id,expires_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", cancellationApprovalId)
      .eq("action", "cancel_bill")
      .eq("target_table", "orders")
      .eq("target_id", orderId)
      .maybeSingle<{ id: string; expires_at: string | null }>();

    if (approvalError) {
      return fail("approval_query_failed", approvalError.message, 500);
    }
    if (!approvalRow) {
      return fail("cancellation_approval_invalid", "Cancellation approval was not found for this order.", 403);
    }
    if (approvalRow.expires_at && new Date(approvalRow.expires_at).getTime() < Date.now()) {
      return fail("cancellation_approval_expired", "Cancellation approval expired. Please request PIN approval again.", 403);
    }

    // Only emit a physical Kitchen CANCEL ticket when this order was actually dispatched to
    // Kitchen before. This avoids printing a misleading cancellation for a draft that never left
    // the POS, while still making a real cancellation immediate instead of waiting for a later
    // reconciliation/polling cycle.
    let hadKitchenTicket = false;
    let kitchenCancelWarning: string | null = null;
    try {
      const routedSupabase = getRoutedSupabaseServiceClient();
      const { data: existingKitchenTicket, error: kitchenTicketError } = await routedSupabase
        .from("kitchen_tickets")
        .select("id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("order_id", orderId)
        .limit(1)
        .maybeSingle();
      if (kitchenTicketError) {
        kitchenCancelWarning = `kitchen_cancel_precheck_failed:${kitchenTicketError.message}`;
      } else {
        hadKitchenTicket = Boolean((existingKitchenTicket as { id?: string } | null)?.id);
      }
    } catch (error) {
      kitchenCancelWarning = `kitchen_cancel_precheck_failed:${error instanceof Error ? error.message : "unknown_error"}`;
    }

    // Restore the ingredient ledger and cancel this queued bill in ONE locked
    // DB transaction. Never switch order.status to cancelled via a plain UPDATE:
    // doing so previously left recipe stock deducted for cancelled POS bills.
    const { data, error } = await supabase.rpc("cancel_queued_pos_order_and_restore_stock_tx", {
      p_tenant_id: auth.tenantId!,
      p_branch_id: auth.branchId!,
      p_order_id: orderId,
      p_actor_user_id: auth.userId,
      p_approval_id: cancellationApprovalId,
      p_reason: body.reason ?? "Cancelled POS bill"
    });
    if (error) {
      const message = error.message ?? "";
      if (message.includes("ORDER_NOT_QUEUED")) {
        return fail("order_not_cancelable", "Only queued orders can be cancelled in POS flow.", 409);
      }
      if (message.includes("ORDER_NOT_FOUND")) {
        return fail("order_not_found", "Order was not found in this branch.", 404);
      }
      if (message.includes("CANCELLATION_APPROVAL_INVALID")) {
        return fail("cancellation_approval_invalid", "PIN approval expired, was consumed, or does not match the order.", 403);
      }
      return fail("cancel_order_failed", "Unable to safely cancel this bill and restore its stock.", 503);
    }
    const cancelledOrder = (Array.isArray(data) ? data[0] : data) as {
      id: string;
      order_no: string;
      status: string;
      cancelled_reason: string | null;
      updated_at: string;
      table_id: string | null;
      restored_ingredient_count: number | null;
      restored_quantity: number | null;
      table_session_closed_count: number | null;
      table_released: boolean | null;
    } | null;
    if (!cancelledOrder) {
      return fail("cancel_order_failed", "Cancellation transaction returned no order.", 503);
    }

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "pos_order_cancelled",
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        reason: body.reason ?? null,
        restored_ingredient_count: cancelledOrder.restored_ingredient_count ?? 0,
        restored_quantity: cancelledOrder.restored_quantity ?? 0,
        table_session_closed_count: cancelledOrder.table_session_closed_count ?? 0,
        table_released: cancelledOrder.table_released === true
      }
    });

    // The transaction already closed only this order's table session and
    // released the table only when no other live session remains. Do not send
    // a second unscoped table update that might close someone else's bill.
    if (cancelledOrder.table_id && Number(cancelledOrder.table_session_closed_count ?? 0) > 0) {
      void appendAuditLog({
        tenantId: auth.tenantId!,
        branchId: auth.branchId!,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "table_bill_cancelled",
        targetTable: "dining_tables",
        targetId: cancelledOrder.table_id,
        metadata: {
          order_id: orderId,
          reason: body.reason ?? null,
          table_session_closed_count: cancelledOrder.table_session_closed_count,
          table_released: cancelledOrder.table_released === true
        }
      });
    }

    let kitchenCancelDispatched = false;
    let kitchenCancelQueuedPrintJobCount = 0;
    if (hadKitchenTicket) {
      try {
        const kitchenResult = await dispatchOrderToKitchen({
          tenantId: auth.tenantId!,
          branchId: auth.branchId!,
          orderId,
          eventKey: `pos_cancel:${orderId}:${cancellationApprovalId}`,
          action: "cancel",
          actorUserId: auth.userId,
          actorRole: auth.branchRole ?? auth.platformRole
        });
        if (kitchenResult.ok) {
          kitchenCancelDispatched = true;
          kitchenCancelQueuedPrintJobCount = kitchenResult.queuedPrintJobCount;
        } else {
          kitchenCancelWarning = `kitchen_cancel_dispatch_failed:${kitchenResult.message}`;
        }
      } catch (dispatchError) {
        kitchenCancelWarning = `kitchen_cancel_dispatch_failed:${dispatchError instanceof Error ? dispatchError.message : "unknown_error"}`;
      }
    }

    if (kitchenCancelWarning) {
      void appendAuditLog({
        tenantId: auth.tenantId!,
        branchId: auth.branchId!,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "pos_order_cancel_kitchen_warning",
        targetTable: "orders",
        targetId: orderId,
        metadata: {
          warning: kitchenCancelWarning,
          had_kitchen_ticket: hadKitchenTicket
        }
      });
    }

    invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    return ok({
      ...cancelledOrder,
      kitchen_cancel_required: hadKitchenTicket,
      kitchen_cancel_dispatched: kitchenCancelDispatched,
      kitchen_cancel_queued_print_job_count: kitchenCancelQueuedPrintJobCount,
      kitchen_cancel_warning: kitchenCancelWarning
    });
  } catch (error) {
    return fail("cancel_order_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}
