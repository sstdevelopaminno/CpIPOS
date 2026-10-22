import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { BranchRole } from "@pos/shared-types";
import { appendAuditLog } from "@/lib/audit-log";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import {
  PosGuardError,
  requireActiveShift,
  requirePermission,
  requirePosSession,
  withPosSessionCookie
} from "@/lib/pos-session-guard";
import {
  hydrateOrderItems,
  hydrateOrderPayments,
  normalizePaymentMethod,
  round2
} from "@/lib/services/pos-sales-mvp-service";
import { deductIngredientStockForPaidOrderFallback } from "@/lib/services/pos-sales-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";

type PayOrderPayload = {
  method?: string;
  amount?: number;
  reference_no?: string | null;
};

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    const { shift } = await requireActiveShift(scope);
    await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
    const { orderId: rawOrderId } = await context.params;
    const orderId = String(rawOrderId ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ data: null, error: { code: "order_id_required", message: "orderId is required." } }, { status: 422 });
    }

    const body = (await request.json().catch(() => null)) as PayOrderPayload | null;
    const method = normalizePaymentMethod(body?.method ?? "cash");
    if (!method) {
      return NextResponse.json({ data: null, error: { code: "invalid_payment_method", message: "Supported methods: cash, bank_transfer." } }, { status: 422 });
    }

    const supabase = getSupabaseServiceClient();
    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,status,shift_id,total_amount,grand_total,paid_total")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("id", orderId)
      .maybeSingle<{
        id: string;
        order_no: string;
        status: string;
        shift_id: string;
        total_amount: number;
        grand_total: number | null;
        paid_total: number | null;
      }>();

    if (orderError) {
      return NextResponse.json({ data: null, error: { code: "order_query_failed", message: orderError.message } }, { status: 500 });
    }
    if (!orderRow) {
      return NextResponse.json({ data: null, error: { code: "order_not_found", message: "Order not found in current scope." } }, { status: 404 });
    }
    if (orderRow.shift_id !== shift.id) {
      return NextResponse.json(
        { data: null, error: { code: "order_shift_mismatch", message: "Order does not belong to current active shift." } },
        { status: 409 }
      );
    }
    if (orderRow.status === "cancelled") {
      return NextResponse.json({ data: null, error: { code: "order_cancelled", message: "Cancelled order cannot be paid." } }, { status: 409 });
    }
    if (orderRow.status === "completed") {
      return NextResponse.json({ data: null, error: { code: "order_already_paid", message: "Order already paid." } }, { status: 409 });
    }

    const dueTotal = round2((orderRow.grand_total ?? orderRow.total_amount ?? 0) - (orderRow.paid_total ?? 0));
    const requestedAmountRaw = body?.amount;
    const amount = requestedAmountRaw === undefined || requestedAmountRaw === null ? dueTotal : round2(Number(requestedAmountRaw));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ data: null, error: { code: "invalid_payment_amount", message: "Payment amount must be greater than zero." } }, { status: 422 });
    }
    const isCashOverOrExact = method === "cash" && amount + 0.009 >= dueTotal;
    const isExactNonCash = method !== "cash" && Math.abs(amount - dueTotal) <= 0.01;
    if (!isCashOverOrExact && !isExactNonCash) {
      return NextResponse.json(
        { data: null, error: { code: "payment_total_mismatch", message: "Cash received must be greater than or equal to the remaining order due." } },
        { status: 409 }
      );
    }

    const requestGroupId = request.headers.get("x-idempotency-key")?.trim() || crypto.randomUUID();
    const isOptical = await requireOpticalRetailEntitlement(scope.session.tenant_id);
    const { data: paymentResultRows, error: paymentRpcError } = await supabase.rpc(
      isOptical ? "optical_complete_pos_payment_tx" : "complete_pos_payment_tx", {
      p_tenant_id: scope.session.tenant_id,
      p_branch_id: scope.session.branch_id,
      p_order_id: orderRow.id,
      p_received_by: scope.session.user_id,
      p_payment_lines: [
        {
          method,
          amount: dueTotal,
          reference_no: String(body?.reference_no ?? "").trim() || null
        }
      ],
      p_request_group_id: requestGroupId
    });

    if (paymentRpcError) {
      void appendAuditLog({
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        actorUserId: scope.session.user_id,
        actorRole: scope.session.role as "owner" | "manager" | "staff" | "accountant",
        action: "order_failed",
        targetTable: "orders",
        targetId: orderRow.id,
        metadata: {
          reason: "payment_rpc_failed",
          message: paymentRpcError.message
        }
      });
      return NextResponse.json({ data: null, error: { code: "payment_failed", message: paymentRpcError.message } }, { status: 500 });
    }

    const paymentResult = Array.isArray(paymentResultRows) ? paymentResultRows[0] : null;
    const paidAmount = round2(Number(paymentResult?.total_paid ?? dueTotal));

    // Atomic Optical RPC has already changed both payment and optical bin counts.
    // Never deduct legacy restaurant ingredients for this product mode.
    if (!isOptical) {
      const stockDeductionResult = await deductIngredientStockForPaidOrderFallback({
        auth: {
          userId: scope.session.user_id,
          platformRole: "tenant_user",
          tenantId: scope.session.tenant_id,
          branchId: scope.session.branch_id,
          branchRole: scope.session.role as BranchRole
        },
        orderId: orderRow.id
      });
      if (!stockDeductionResult.ok) {
        return NextResponse.json(
          { data: null, error: { code: stockDeductionResult.code, message: stockDeductionResult.message } },
          { status: stockDeductionResult.status }
        );
      }
    }

    await supabase
      .from("payments")
      .update({
        shift_id: shift.id,
        pos_session_id: scope.session.id,
        status: "paid",
        metadata: {
          source: "pos_sales_mvp"
        }
      })
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("order_id", orderRow.id)
      .eq("request_group_id", requestGroupId);

    const completedAt = new Date().toISOString();
    const cashReceived = method === "cash" ? round2(amount) : null;
    const changeAmount = method === "cash" ? round2(Math.max(0, amount - dueTotal)) : null;

    await supabase
      .from("orders")
      .update({
        paid_total: round2((orderRow.paid_total ?? 0) + paidAmount),
        pos_session_id: scope.session.id,
        cashier_user_id: scope.session.user_id,
        device_code: scope.session.device_code,
        status: "completed",
        payment_completed_at: completedAt,
        payment_completed_by: scope.session.user_id,
        cash_received: cashReceived,
        change_amount: changeAmount
      })
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("id", orderRow.id);

    void appendAuditLog({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      actorUserId: scope.session.user_id,
      actorRole: scope.session.role as "owner" | "manager" | "staff" | "accountant",
      action: "payment_created",
      targetTable: "payments",
      targetId: requestGroupId,
      metadata: {
        order_id: orderRow.id,
        method,
        amount: paidAmount,
        shift_id: shift.id,
        pos_session_id: scope.session.id
      }
    });

    void appendAuditLog({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      actorUserId: scope.session.user_id,
      actorRole: scope.session.role as "owner" | "manager" | "staff" | "accountant",
      action: "order_paid",
      targetTable: "orders",
      targetId: orderRow.id,
      metadata: {
        request_group_id: requestGroupId,
        paid_total: paidAmount
      }
    });

    const { items } = await hydrateOrderItems({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      orderId: orderRow.id
    });
    const { payments } = await hydrateOrderPayments({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      orderId: orderRow.id
    });
    const storeProfile = await loadReceiptStoreProfile(scope.session.tenant_id);

    const response = NextResponse.json({
      data: {
        order: {
          id: orderRow.id,
          order_no: orderRow.order_no,
          status: "completed"
        },
        payment: {
          method,
          amount: paidAmount,
          request_group_id: requestGroupId
        },
        receipt_preview: {
          order_no: orderRow.order_no,
          items,
          payments,
          store_profile: storeProfile,
          total: round2(orderRow.grand_total ?? orderRow.total_amount ?? paidAmount),
          paid_total: round2((orderRow.paid_total ?? 0) + paidAmount),
          cash_received: cashReceived,
          change_total: changeAmount ?? 0
        }
      },
      error: null
    });

    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof FeatureGateError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    if (error instanceof PosGuardError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { data: null, error: { code: "order_pay_failed", message: error instanceof Error ? error.message : "Unknown error." } },
      { status: 500 }
    );
  }
}
