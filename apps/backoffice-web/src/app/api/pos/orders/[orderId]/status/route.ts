import { NextResponse } from "next/server";
import {
  PosGuardError,
  requirePermission,
  requirePosSession,
  withPosSessionCookie
} from "@/lib/pos-session-guard";
import {
  hydrateOrderItems,
  hydrateOrderPayments,
  round2
} from "@/lib/services/pos-sales-mvp-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/**
 * Read-only scoped recovery endpoint for Native POS.
 *
 * This intentionally does NOT require the order's original shift to still be open.
 * A cashier with an active POS session and sale:create permission may inspect an
 * order only inside the same tenant + branch. That makes an uncertain mobile
 * checkout recoverable after process/network failure without opening a second bill.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    const { orderId } = await context.params;
    const normalizedOrderId = String(orderId ?? "").trim();
    if (!normalizedOrderId) {
      return NextResponse.json(
        { data: null, error: { code: "order_id_required", message: "orderId is required." } },
        { status: 422 }
      );
    }

    const supabase = getSupabaseServiceClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id,order_no,status,shift_id,total_amount,grand_total,paid_total,cash_received,change_amount,created_at,payment_completed_at,payment_completed_by,created_by,device_code"
      )
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("id", normalizedOrderId)
      .maybeSingle<{
        id: string;
        order_no: string;
        status: string;
        shift_id: string | null;
        total_amount: number | null;
        grand_total: number | null;
        paid_total: number | null;
        cash_received: number | null;
        change_amount: number | null;
        created_at: string;
        payment_completed_at: string | null;
        payment_completed_by: string | null;
        created_by: string | null;
        device_code: string | null;
      }>();

    if (orderError) {
      return NextResponse.json(
        { data: null, error: { code: "order_status_query_failed", message: orderError.message } },
        { status: 500 }
      );
    }
    if (!order) {
      return NextResponse.json(
        { data: null, error: { code: "order_not_found", message: "Order was not found in this branch." } },
        { status: 404 }
      );
    }

    const [{ items, error: itemsError }, { payments, error: paymentsError }, branchResult, storeProfile] =
      await Promise.all([
        hydrateOrderItems({
          tenantId: scope.session.tenant_id,
          branchId: scope.session.branch_id,
          orderId: order.id
        }),
        hydrateOrderPayments({
          tenantId: scope.session.tenant_id,
          branchId: scope.session.branch_id,
          orderId: order.id
        }),
        supabase
          .from("branches")
          .select("name")
          .eq("tenant_id", scope.session.tenant_id)
          .eq("id", scope.session.branch_id)
          .maybeSingle<{ name: string | null }>(),
        loadReceiptStoreProfile(scope.session.tenant_id)
      ]);

    if (itemsError) {
      return NextResponse.json(
        { data: null, error: { code: "order_status_items_failed", message: itemsError } },
        { status: 500 }
      );
    }
    if (paymentsError) {
      return NextResponse.json(
        { data: null, error: { code: "order_status_payments_failed", message: paymentsError } },
        { status: 500 }
      );
    }
    if (branchResult.error) {
      return NextResponse.json(
        { data: null, error: { code: "order_status_branch_failed", message: branchResult.error.message } },
        { status: 500 }
      );
    }

    const userIds = Array.from(
      new Set([order.created_by, order.payment_completed_by].filter((id): id is string => Boolean(id)))
    );
    const userResult = userIds.length
      ? await supabase.from("users_profiles").select("id,full_name").in("id", userIds)
      : { data: [], error: null };
    if (userResult.error) {
      return NextResponse.json(
        { data: null, error: { code: "order_status_users_failed", message: userResult.error.message } },
        { status: 500 }
      );
    }
    const userMap = new Map(
      (userResult.data ?? []).map((row) => [String(row.id), String(row.full_name ?? row.id)])
    );

    const total = round2(Number(order.grand_total ?? order.total_amount ?? 0));
    const paidTotal = round2(Number(order.paid_total ?? 0));
    const cashReceived = round2(Number(order.cash_received ?? 0));
    const changeAmount = round2(Number(order.change_amount ?? 0));

    const response = NextResponse.json({
      data: {
        order: {
          id: order.id,
          order_no: order.order_no,
          status: order.status,
          shift_id: order.shift_id,
          total,
          paid_total: paidTotal,
          cash_received: cashReceived,
          change_amount: changeAmount,
          created_at: order.created_at,
          payment_completed_at: order.payment_completed_at,
          device_code: order.device_code
        },
        items,
        payments,
        branch: {
          id: scope.session.branch_id,
          name: String(branchResult.data?.name ?? scope.session.branch_id)
        },
        store_profile: storeProfile,
        seller_name: order.created_by ? userMap.get(order.created_by) ?? order.created_by : "-",
        cashier_name: order.payment_completed_by
          ? userMap.get(order.payment_completed_by) ?? order.payment_completed_by
          : "-"
      },
      error: null
    });
    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json(
        { data: null, error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "order_status_failed",
          message: error instanceof Error ? error.message : "Unknown error."
        }
      },
      { status: 500 }
    );
  }
}
