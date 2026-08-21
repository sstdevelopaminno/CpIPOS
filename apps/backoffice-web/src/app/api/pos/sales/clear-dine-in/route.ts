import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { getDevicePolicyBlockMessage, loadPosRuntimeDevicePolicyForSession } from "@/lib/pos-device-status";
import { PosGuardError, requireActiveShift, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { queueMissingKitchenPrintJobsForOrder } from "@/lib/services/kitchen-routing-service";
import { invalidatePosSalesListCacheForScope } from "@/lib/services/pos-sales-list-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type ClearDineInPayload = {
  order_id?: string;
  table_id?: string;
};

type ClearDineInRpcRow = {
  order_id: string;
  order_no: string;
  order_status: string;
  created_at: string;
  total_amount: number;
};

type NonNullBranchRole = Exclude<AuthContext["branchRole"], null>;

function normalizeBranchRole(role: string): NonNullBranchRole {
  if (role === "owner" || role === "manager" || role === "staff" || role === "accountant") return role;
  return "staff";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapRpcError(message: string) {
  if (message.includes("ORDER_NOT_QUEUED")) return { code: "order_not_updatable", status: 409 };
  if (message.includes("ORDER_NOT_FOUND")) return { code: "order_not_found", status: 404 };
  if (message.includes("TABLE_BILL_ORDER_CONFLICT")) return { code: "table_bill_order_conflict", status: 409 };
  if (message.includes("TABLE_BILL_NOT_OPEN")) return { code: "table_bill_not_open", status: 409 };
  if (message.includes("SHIFT_NOT_OPEN")) return { code: "shift_not_open", status: 409 };
  return { code: "dine_in_clear_failed", status: 500 };
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    const { shift } = await requireActiveShift(scope);
    await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);

    const devicePolicy = await loadPosRuntimeDevicePolicyForSession(scope.session);
    if (devicePolicy.block_sales) {
      return fail(
        devicePolicy.reason_code ?? "pos_device_unavailable",
        getDevicePolicyBlockMessage(devicePolicy),
        423
      );
    }

    const body = (await request.json().catch(() => null)) as ClearDineInPayload | null;
    const orderId = String(body?.order_id ?? "").trim();
    const tableId = String(body?.table_id ?? "").trim();
    if (!isUuid(orderId) || !isUuid(tableId)) {
      return fail("invalid_clear_target", "A valid dine-in order_id and table_id are required.", 422);
    }

    const supabase = getSupabaseServiceClient();

    // Verify the target before any write. The clear endpoint must never discover or select
    // another order implicitly; it only mutates the exact queued order currently bound to
    // the exact open table bill supplied by the POS UI.
    const [{ data: session, error: sessionError }, { data: order, error: orderError }] = await Promise.all([
      supabase
        .from("table_bill_sessions")
        .select("id,status,closed_at,order_id,table_id")
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id)
        .eq("table_id", tableId)
        .in("status", ["open", "ordering"])
        .is("closed_at", null)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; status: string; closed_at: string | null; order_id: string | null; table_id: string }>(),
      supabase
        .from("orders")
        .select("id,order_no,status,order_type,table_id,total_amount")
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id)
        .eq("id", orderId)
        .maybeSingle<{ id: string; order_no: string; status: string; order_type: string; table_id: string | null; total_amount: number }>()
    ]);

    if (sessionError) return fail("table_bill_query_failed", sessionError.message, 500);
    if (orderError) return fail("order_query_failed", orderError.message, 500);
    if (!session) return fail("table_bill_not_open", "The selected table bill is no longer open.", 409);
    if (session.order_id !== orderId) return fail("table_bill_order_conflict", "The table bill is bound to another order. Reload the table.", 409);
    if (!order) return fail("order_not_found", "The queued dine-in order no longer exists.", 404);
    if (order.status !== "queued" || order.order_type !== "dine_in" || order.table_id !== tableId) {
      return fail("order_not_updatable", "Only the exact queued dine-in order bound to this table can be cleared.", 409);
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc("replace_queued_dine_in_order_tx", {
      p_tenant_id: scope.session.tenant_id,
      p_branch_id: scope.session.branch_id,
      p_shift_id: shift.id,
      p_actor_user_id: scope.session.user_id,
      p_order_id: orderId,
      p_table_id: tableId,
      p_items: [],
      p_app_total_amount: 0,
      p_discount_amount: 0,
      p_gp_amount: 0,
      p_tax_total: 0,
      p_grand_total: 0,
      p_tax_lines: []
    });

    if (rpcError) {
      const mapped = mapRpcError(rpcError.message || "Unable to clear queued dine-in bill.");
      return fail(mapped.code, rpcError.message || "Unable to clear queued dine-in bill.", mapped.status);
    }

    const updated = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ClearDineInRpcRow | null;
    if (!updated?.order_id) {
      return fail("dine_in_clear_failed", "Dine-in clear returned no order state.", 500);
    }

    const auth: AuthContext = {
      userId: scope.session.user_id,
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      branchRole: normalizeBranchRole(scope.session.role),
      platformRole: "tenant_user"
    };

    // The RPC emits compensating kitchen cancel deltas. Recovery only ensures those
    // already-created kitchen tickets have their routed print jobs; it never replays sale/payment.
    await queueMissingKitchenPrintJobsForOrder({
      auth,
      orderId,
      runtimeDeviceCode: scope.session.device_code
    }).catch((error) => {
      console.warn("[pos-sales-clear-dine-in] kitchen print recovery failed", {
        order_id: orderId,
        message: error instanceof Error ? error.message : "kitchen_print_recovery_failed"
      });
    });

    invalidatePosScopeRuntimeCaches({ tenantId: scope.session.tenant_id, branchId: scope.session.branch_id });
    invalidatePosSalesListCacheForScope({ tenantId: scope.session.tenant_id, branchId: scope.session.branch_id });

    void appendAuditLog({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      actorUserId: scope.session.user_id,
      actorRole: normalizeBranchRole(scope.session.role),
      action: "pos_dine_in_bill_items_cleared",
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        table_id: tableId,
        table_bill_session_id: session.id,
        order_no: order.order_no,
        previous_total_amount: Number(order.total_amount ?? 0),
        resulting_total_amount: Number(updated.total_amount ?? 0),
        semantics: "cashier_desired_state_with_kitchen_cancel_delta"
      }
    });

    return ok({
      id: updated.order_id,
      order_no: updated.order_no,
      status: updated.order_status,
      total_amount: Number(updated.total_amount ?? 0),
      created_at: updated.created_at,
      table_id: tableId,
      updated_existing: true,
      cleared_items: true
    });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("dine_in_clear_failed", error instanceof Error ? error.message : "Unable to clear queued dine-in bill.", 500);
  }
}
