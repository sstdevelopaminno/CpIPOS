import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { dispatchOrderToKitchen } from "@/lib/services/kitchen-routing-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

function isMissingColumnError(message: string, column: string): boolean {
  return message.includes(`column "${column}"`) && message.includes("does not exist");
}

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

    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_by: auth.userId,
        cancelled_reason: body.reason ?? null,
        cancellation_approval_id: cancellationApprovalId
      })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", orderId)
      .eq("status", "queued")
      .select("id,order_no,status,cancelled_reason,updated_at,table_id")
      .maybeSingle();

    let cancelledOrder = data;
    if (error) {
      if (!isMissingColumnError(error.message, "cancellation_approval_id")) {
        return fail("cancel_order_failed", error.message, 500);
      }

      const fallbackUpdate = await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_by: auth.userId,
          cancelled_reason: body.reason ?? null
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", orderId)
        .eq("status", "queued")
        .select("id,order_no,status,cancelled_reason,updated_at,table_id")
        .maybeSingle();

      if (fallbackUpdate.error) {
        return fail("cancel_order_failed", fallbackUpdate.error.message, 500);
      }
      if (!fallbackUpdate.data) {
        return fail("order_not_cancelable", "Only queued orders can be cancelled in POS flow.", 409);
      }
      cancelledOrder = fallbackUpdate.data;
    }
    if (!cancelledOrder) {
      return fail("order_not_cancelable", "Only queued orders can be cancelled in POS flow.", 409);
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
        fallback_hard_cancel: Boolean(error)
      }
    });

    if (cancelledOrder.table_id) {
      const closedAt = new Date().toISOString();
      await Promise.allSettled([
        supabase
          .from("table_bill_sessions")
          .update({
            status: "cancelled",
            closed_by: auth.userId,
            closed_at: closedAt
          })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("table_id", cancelledOrder.table_id)
          .in("status", ["open", "ordering", "pending_payment"]),
        supabase
          .from("dining_tables")
          .update({ status: "available" })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("id", cancelledOrder.table_id)
      ]);

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
          reason: body.reason ?? null
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
