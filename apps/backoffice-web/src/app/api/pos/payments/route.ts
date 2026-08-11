import type { PaymentMethod } from "@pos/shared-types";
import { after } from "next/server";
import { appendAuditLog } from "@/lib/audit-log";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { getDevicePolicyBlockMessage, loadPosRuntimeDevicePolicyForSession } from "@/lib/pos-device-status";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { appendPosDeadLetter, POS_GUARDS } from "@/lib/pos-resilience";
import { queueRoutedKitchenFallback, queueRoutedSalesReceipt } from "@/lib/printing/routed-print-service";
import { dispatchOrderToKitchen } from "@/lib/services/kitchen-routing-service";
import { invalidatePosSalesListCacheForScope } from "@/lib/services/pos-sales-list-service";
import { executeCompletePosPaymentTransaction } from "@/lib/services/pos-sales-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type CompletePaymentPayload = {
  order_id: string;
  payment_lines: Array<{
    method: PaymentMethod;
    amount: number;
    reference_no?: string | null;
  }>;
  transfer_verification_id?: string | null;
  transfer_override_approval_id?: string | null;
  skip_transfer_verification?: boolean;
  cash_received?: number;
  change_amount?: number;
  print_kitchen_ticket?: boolean;
};

type TransferVerificationRow = {
  id: string;
  verification_status: "passed" | "failed" | "override_passed" | "error";
  checks: { passed?: boolean } | null;
  override_approval_id: string | null;
  verified_by: string;
};

type ApprovalRow = {
  id: string;
  action: string;
  target_table: string;
  target_id: string | null;
  approved_by: string;
  expires_at: string;
};

type PaymentOrderLookupRow = {
  id: string;
  order_type: string;
  table_id: string | null;
  external_order_code: string | null;
};

function isMissingColumnError(message: string, column: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes(column.toLowerCase()) && (normalized.includes("column") || normalized.includes("schema cache"));
}

export async function GET(req: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    const supabase = getSupabaseServiceClient();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status")?.trim() || "queued";

    const { data, error } = await supabase
      .from("orders")
      .select("id,order_no,order_type,customer_name,total_amount,status,created_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return fail("payments_order_query_failed", error.message, 500);
    return ok({ items: data ?? [] });
  } catch (error) {
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "receipts:view");
    const devicePolicy = await loadPosRuntimeDevicePolicyForSession(scope.session);
    if (devicePolicy.block_sales) {
      const response = fail(devicePolicy.reason_code ?? "pos_device_unavailable", getDevicePolicyBlockMessage(devicePolicy), 423);
      response.headers.set("x-pos-payments-device-status", devicePolicy.status);
      response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
      return response;
    }
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    const supabase = getSupabaseServiceClient();
    const body = (await req.json()) as CompletePaymentPayload;

    if (!body.order_id) {
      const response = fail("missing_order_id", "order_id is required.", 422);
      response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
      return response;
    }
    if (!Array.isArray(body.payment_lines) || body.payment_lines.length === 0) {
      const response = fail("payment_lines_required", "At least one payment line is required.", 422);
      response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
      return response;
    }

    const { data: paymentOrder, error: paymentOrderError } = await supabase
      .from("orders")
      .select("id,order_type,table_id,external_order_code")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", body.order_id)
      .maybeSingle<PaymentOrderLookupRow>();
    if (paymentOrderError) {
      const response = fail("order_query_failed", paymentOrderError.message, 500);
      response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
      return response;
    }
    if (!paymentOrder) {
      const response = fail("order_not_found", "Order not found in current branch.", 404);
      response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
      return response;
    }
    const paymentMethod = body.payment_lines[0]?.method ?? "cash";
    const paymentTotal = Number(body.payment_lines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0).toFixed(2));
    const cashReceivedAmount = Number(body.cash_received ?? paymentTotal);
    if (paymentMethod === "cash" && (!Number.isFinite(cashReceivedAmount) || cashReceivedAmount + 0.009 < paymentTotal)) {
      const response = fail("cash_received_insufficient", "Cash received must be greater than or equal to the payment amount.", 422);
      response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
      return response;
    }

    let transferVerification: TransferVerificationRow | null = null;
    let overrideApproval: ApprovalRow | null = null;
    let usedTransferOverride = false;
    let usedQrOnlyTransfer = false;
    if (paymentMethod === "bank_transfer") {
      const transferVerificationId = body.transfer_verification_id?.trim();
      const allowQrOnlyTransfer = body.skip_transfer_verification === true;
      if (!transferVerificationId) {
        if (!allowQrOnlyTransfer) {
          const response = fail("transfer_verification_required", "Bank transfer payment requires a verified transfer slip, override approval, or QR-only confirmation.", 422);
          response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
          return response;
        }
        usedQrOnlyTransfer = true;
      } else {
        const { data: verificationRow, error: verificationError } = await supabase
          .from("transfer_payment_verifications")
          .select("id,verification_status,checks,override_approval_id,verified_by")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("order_id", body.order_id)
          .eq("id", transferVerificationId)
          .maybeSingle<TransferVerificationRow>();
        if (verificationError) {
          const response = fail("transfer_verification_query_failed", verificationError.message, 500);
          response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
          return response;
        }
        if (!verificationRow) {
          const response = fail("transfer_verification_not_found", "Transfer verification record was not found for this order.", 404);
          response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
          return response;
        }

        transferVerification = verificationRow;
        const checksPassed = verificationRow.verification_status === "passed" || verificationRow.verification_status === "override_passed" || verificationRow.checks?.passed === true;
        if (!checksPassed) {
          const overrideApprovalId = body.transfer_override_approval_id?.trim();
          if (!overrideApprovalId) {
            const response = fail("transfer_override_required", "Transfer verification failed. Manager/owner/IT Admin override approval is required.", 403);
            response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
            return response;
          }

          const { data: approvalRow, error: approvalError } = await supabase
            .from("manager_pin_approvals")
            .select("id,action,target_table,target_id,approved_by,expires_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("id", overrideApprovalId)
            .maybeSingle<ApprovalRow>();
          if (approvalError) {
            const response = fail("transfer_override_approval_query_failed", approvalError.message, 500);
            response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
            return response;
          }
          if (!approvalRow || approvalRow.action !== "transfer_payment_override") {
            const response = fail("transfer_override_approval_invalid", "Transfer override approval is invalid.", 403);
            response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
            return response;
          }
          if (approvalRow.target_table !== "orders" || approvalRow.target_id !== body.order_id) {
            const response = fail("transfer_override_target_mismatch", "Transfer override approval does not match this order.", 403);
            response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
            return response;
          }
          const expiresAt = new Date(approvalRow.expires_at).getTime();
          if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
            const response = fail("transfer_override_approval_expired", "Transfer override approval has expired.", 403);
            response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
            return response;
          }
          overrideApproval = approvalRow;
          usedTransferOverride = true;
        }
      }
    }

    const requestGroupId = req.headers.get("x-idempotency-key")?.trim() || crypto.randomUUID();
    const txResult = await executeCompletePosPaymentTransaction({ auth, input: { order_id: body.order_id, payment_lines: body.payment_lines }, requestGroupId });
    if (!txResult.ok) {
      const response = fail(txResult.code, txResult.message, txResult.status);
      response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
      return response;
    }

    const paidTotal = paymentTotal;
    const receivedAmount = cashReceivedAmount;
    const changeAmount = Number(body.change_amount ?? Math.max(0, receivedAmount - paidTotal));
    const { error: orderSnapshotUpdateError } = await supabase
      .from("orders")
      .update({ cash_received: receivedAmount, change_amount: changeAmount, payment_completed_at: new Date().toISOString(), payment_completed_by: auth.userId })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", body.order_id);
    if (orderSnapshotUpdateError) {
      const normalized = orderSnapshotUpdateError.message.toLowerCase();
      const missingColumn = normalized.includes("cash_received") || normalized.includes("change_amount") || normalized.includes("payment_completed_at") || normalized.includes("payment_completed_by");
      if (!missingColumn) {
        const response = fail("order_snapshot_update_failed", orderSnapshotUpdateError.message, 500);
        response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
        return response;
      }
    }

    if (paymentMethod === "bank_transfer" && transferVerification) {
      if (usedTransferOverride && overrideApproval) {
        await supabase.from("transfer_payment_verifications").update({ verification_status: "override_passed", override_approval_id: overrideApproval.id, override_by: overrideApproval.approved_by }).eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("id", transferVerification.id);
        void appendAuditLog({ tenantId: auth.tenantId!, branchId: auth.branchId!, actorUserId: auth.userId, actorRole: auth.branchRole ?? auth.platformRole, action: "transfer_payment_override_used", targetTable: "transfer_payment_verifications", targetId: transferVerification.id, overrideByUserId: overrideApproval.approved_by, metadata: { order_id: body.order_id, approval_id: overrideApproval.id } });
      } else {
        void appendAuditLog({ tenantId: auth.tenantId!, branchId: auth.branchId!, actorUserId: auth.userId, actorRole: auth.branchRole ?? auth.platformRole, action: "transfer_payment_verified_complete", targetTable: "transfer_payment_verifications", targetId: transferVerification.id, metadata: { order_id: body.order_id } });
      }

      const { error: paymentLinkError } = await supabase
        .from("payments")
        .update({ transfer_verification_id: transferVerification.id, transfer_override_approval_id: usedTransferOverride ? overrideApproval?.id ?? null : null })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("order_id", body.order_id)
        .eq("request_group_id", requestGroupId);
      if (paymentLinkError) {
        const missingTransferColumns = isMissingColumnError(paymentLinkError.message, "transfer_verification_id") || isMissingColumnError(paymentLinkError.message, "transfer_override_approval_id");
        const missingRequestGroup = isMissingColumnError(paymentLinkError.message, "request_group_id");
        if (!missingTransferColumns && !missingRequestGroup) {
          const response = fail("payment_transfer_link_failed", paymentLinkError.message, 500);
          response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
          return response;
        }
      }
    }
    if (paymentMethod === "bank_transfer" && usedQrOnlyTransfer) {
      void appendAuditLog({ tenantId: auth.tenantId!, branchId: auth.branchId!, actorUserId: auth.userId, actorRole: auth.branchRole ?? auth.platformRole, action: "transfer_payment_qr_only_settled", targetTable: "orders", targetId: body.order_id, metadata: { order_id: body.order_id, order_type: paymentOrder.order_type, external_order_code: paymentOrder.external_order_code } });
    }

    const printJobsQueued = 0;
    const printWarning: string | null = null;
    after(async () => {
      let skipPrintEnqueue = false;
      try {
        const { count: printQueueDepth, error: printQueueDepthError } = await supabase
          .from("print_jobs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("status", ["pending", "printing", "retrying"]);
        if (printQueueDepthError) throw new Error(`print_queue_depth_query_failed: ${printQueueDepthError.message}`);
        if ((printQueueDepth ?? 0) >= POS_GUARDS.printQueueHardLimit) {
          const warning = `print_queue_overloaded (${printQueueDepth}/${POS_GUARDS.printQueueHardLimit})`;
          skipPrintEnqueue = true;
          appendPosDeadLetter({ auth, channel: "print", targetTable: "print_jobs", targetId: body.order_id, reason: "print_queue_overloaded", metadata: { queue_depth: printQueueDepth ?? 0, queue_limit: POS_GUARDS.printQueueHardLimit, detail: warning, deferred: true } });
        }
        if (!skipPrintEnqueue) {
          const [{ data: orderRow, error: orderError }, { data: itemRows, error: itemError }] = await Promise.all([
            supabase.from("orders").select("id,order_no,total_amount,discount_amount,notes,customer_name,table_id").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("id", body.order_id).single(),
            supabase.from("order_items").select("quantity,unit_price,line_total,notes,products(name)").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("order_id", body.order_id)
          ]);
          if (orderError) throw new Error(orderError.message);
          if (itemError) throw new Error(itemError.message);

          await queueRoutedSalesReceipt({
            auth,
            runtimeDeviceCode: scope.session.device_code,
            order: { id: orderRow.id, order_no: orderRow.order_no, total_amount: Number(orderRow.total_amount), discount_amount: Number(orderRow.discount_amount ?? 0), notes: orderRow.notes, cash_received: receivedAmount, change_amount: changeAmount },
            items: (itemRows ?? []).map((row) => ({ product_name: ((row.products as { name?: string } | null)?.name ?? "Item").toString(), quantity: Number(row.quantity), unit_price: Number(row.unit_price), line_total: Number(row.line_total), note: row.notes })),
            paymentMethod
          });

          if (body.print_kitchen_ticket === true) {
            const kitchenResult = await dispatchOrderToKitchen({ tenantId: auth.tenantId!, branchId: auth.branchId!, orderId: body.order_id, eventKey: `payment-kitchen:${requestGroupId}`, action: "reprint", actorUserId: auth.userId, actorRole: auth.branchRole ?? auth.platformRole });
            if (!kitchenResult.ok) throw new Error(kitchenResult.message);
            if (kitchenResult.routedZoneCount === 0) {
              await queueRoutedKitchenFallback({ auth, orderId: body.order_id, runtimeDeviceCode: scope.session.device_code, action: "reprint" });
            }
          }
        }
      } catch (printError) {
        const warning = printError instanceof Error ? printError.message : "print_queue_failed";
        appendPosDeadLetter({ auth, channel: "print", targetTable: "print_jobs", targetId: body.order_id, reason: "print_queue_failed", metadata: { detail: warning, runtime_device_code: scope.session.device_code, deferred: true } });
      }
    });

    if (paymentOrder.table_id) {
      await Promise.all([
        supabase.from("table_bill_sessions").update({ status: "closed", closed_by: auth.userId, closed_at: new Date().toISOString() }).eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("table_id", paymentOrder.table_id).in("status", ["open", "ordering", "pending_payment"]),
        supabase.from("dining_tables").update({ status: "available" }).eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("id", paymentOrder.table_id)
      ]);
    }

    const response = ok({ ...txResult.data, request_group_id: requestGroupId, cash_received: receivedAmount, change_amount: changeAmount, print_jobs_queued: printJobsQueued, print_warning: printWarning, print_jobs_deferred: true });
    invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = fail("pos_payment_failed", error instanceof Error ? error.message : "Unknown error", 400);
    response.headers.set("x-pos-payments-ms", String(Date.now() - startedAt));
    return response;
  }
}
