import "server-only";

import type { PaymentMethod } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { appendPosDeadLetter, POS_GUARDS } from "@/lib/pos-resilience";
import { enqueuePrintJobsForOrderSnapshot } from "@/lib/printing/print-service";
import { invalidatePosSalesListCacheForScope } from "@/lib/services/pos-sales-list-service";
import { executeCompletePosPaymentTransaction } from "@/lib/services/pos-sales-service";
import { completeTrustedProviderPayment } from "@/lib/payments/provider-payment-router";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type FinalizePosPaymentArgs = {
  auth: AuthContext;
  orderId: string;
  amount: number;
  method: PaymentMethod;
  referenceNo: string | null;
  requestGroupId: string;
  auditAction?: string;
  trustedProvider?: "inet_nops";
};

function isMissingOrderSnapshotColumn(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("cash_received") ||
    normalized.includes("change_amount") ||
    normalized.includes("payment_completed_at") ||
    normalized.includes("payment_completed_by")
  );
}

export async function finalizePosPayment(args: FinalizePosPaymentArgs) {
  const { auth, orderId, amount, method, referenceNo, requestGroupId, auditAction, trustedProvider } = args;
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", status: 401, message: "Missing tenant/branch scope." };
  }

  const supabase = getSupabaseServiceClient();
  const txResult = trustedProvider
    ? await completeTrustedProviderPayment({
        tenantId: auth.tenantId,
        branchId: auth.branchId,
        orderId,
        receivedBy: auth.userId,
        amount,
        referenceNo,
        requestGroupId,
        provider: trustedProvider
      })
    : await executeCompletePosPaymentTransaction({
        auth,
        input: {
          order_id: orderId,
          payment_lines: [
            {
              method,
              amount,
              reference_no: referenceNo
            }
          ]
        },
        requestGroupId
      });

  if (!txResult.ok) {
    return txResult;
  }

  const nowIso = new Date().toISOString();
  const orderSnapshotUpdate = await supabase
    .from("orders")
    .update({
      cash_received: amount,
      change_amount: 0,
      payment_completed_at: nowIso,
      payment_completed_by: auth.userId
    })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", orderId);

  if (orderSnapshotUpdate.error && !isMissingOrderSnapshotColumn(orderSnapshotUpdate.error.message)) {
    return { ok: false as const, code: "order_snapshot_update_failed", status: 500, message: orderSnapshotUpdate.error.message };
  }

  let printJobsQueued = 0;
  let printWarning: string | null = null;
  try {
    const { count: printQueueDepth, error: printQueueDepthError } = await supabase
      .from("print_jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .in("status", ["pending", "printing", "retrying"]);
    if (printQueueDepthError) {
      throw new Error(`print_queue_depth_query_failed: ${printQueueDepthError.message}`);
    }
    if ((printQueueDepth ?? 0) >= POS_GUARDS.printQueueHardLimit) {
      printWarning = `print_queue_overloaded (${printQueueDepth}/${POS_GUARDS.printQueueHardLimit})`;
      appendPosDeadLetter({
        auth,
        channel: "print",
        targetTable: "print_jobs",
        targetId: orderId,
        reason: "print_queue_overloaded",
        metadata: {
          queue_depth: printQueueDepth ?? 0,
          queue_limit: POS_GUARDS.printQueueHardLimit
        }
      });
    } else {
      const [{ data: orderRow, error: orderError }, { data: itemRows, error: itemError }] = await Promise.all([
        supabase
          .from("orders")
          .select("id,order_no,total_amount,discount_amount,notes,customer_name,table_id")
          .eq("tenant_id", auth.tenantId)
          .eq("branch_id", auth.branchId)
          .eq("id", orderId)
          .single(),
        supabase
          .from("order_items")
          .select("quantity,unit_price,line_total,notes,products(name)")
          .eq("tenant_id", auth.tenantId)
          .eq("branch_id", auth.branchId)
          .eq("order_id", orderId)
      ]);
      if (orderError) throw new Error(orderError.message);
      if (itemError) throw new Error(itemError.message);

      const jobs = await enqueuePrintJobsForOrderSnapshot({
        auth,
        order: {
          id: orderRow.id,
          order_no: orderRow.order_no,
          total_amount: Number(orderRow.total_amount),
          discount_amount: Number(orderRow.discount_amount ?? 0),
          notes: orderRow.notes,
          customer_name: orderRow.customer_name
        },
        items: (itemRows ?? []).map((row) => ({
          product_name: ((row.products as { name?: string } | null)?.name ?? "Item").toString(),
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          line_total: Number(row.line_total),
          note: row.notes
        })),
        paymentMethod: method,
        includeKitchenTicket: false
      });
      printJobsQueued = jobs.length;

      if (orderRow.table_id) {
        await Promise.all([
          supabase
            .from("table_bill_sessions")
            .update({
              status: "closed",
              closed_by: auth.userId,
              closed_at: nowIso
            })
            .eq("tenant_id", auth.tenantId)
            .eq("branch_id", auth.branchId)
            .eq("table_id", orderRow.table_id)
            .in("status", ["open", "ordering", "pending_payment"]),
          supabase
            .from("dining_tables")
            .update({ status: "available" })
            .eq("tenant_id", auth.tenantId)
            .eq("branch_id", auth.branchId)
            .eq("id", orderRow.table_id)
        ]);
      }
    }
  } catch (printError) {
    printWarning = printError instanceof Error ? printError.message : "print_queue_failed";
    appendPosDeadLetter({
      auth,
      channel: "print",
      targetTable: "print_jobs",
      targetId: orderId,
      reason: "print_queue_failed",
      metadata: {
        detail: printWarning
      }
    });
  }

  if (auditAction) {
    void appendAuditLog({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: auditAction,
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        amount,
        method,
        reference_no: referenceNo,
        request_group_id: requestGroupId,
        trusted_provider: trustedProvider ?? null
      }
    });
  }

  invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId, branchId: auth.branchId });
  invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId, branchId: auth.branchId });

  return {
    ok: true as const,
    data: {
      ...txResult.data,
      request_group_id: requestGroupId,
      cash_received: amount,
      change_amount: 0,
      print_jobs_queued: printJobsQueued,
      print_warning: printWarning
    }
  };
}
