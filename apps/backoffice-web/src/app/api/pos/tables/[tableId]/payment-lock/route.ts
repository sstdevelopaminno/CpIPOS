import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type PaymentLockPayload = {
  order_id?: string | null;
  locked?: boolean;
};

type PaymentLockRow = {
  table_session_id: string;
  table_id: string;
  order_id: string;
  status: string;
};

function mapPaymentLockError(message: string, code?: string | null) {
  const normalized = message.toLowerCase();
  if (normalized.includes("table_session_not_open")) {
    return fail("table_session_not_open", "Active table bill session was not found for this order.", 404);
  }
  if (normalized.includes("order_not_found")) {
    return fail("order_not_found", "Order was not found for this table.", 404);
  }
  if (normalized.includes("order_not_payable")) {
    return fail("order_not_payable", "Order can no longer enter payment.", 409);
  }
  if (normalized.includes("table_not_available")) {
    return fail("table_not_available", "Table is not available for payment.", 409);
  }
  if (code === "55P03" || code === "40P01" || normalized.includes("lock timeout") || normalized.includes("deadlock")) {
    return fail("table_payment_lock_busy", "โต๊ะกำลังมีรายการอื่นดำเนินการอยู่ กรุณาลองอีกครั้ง", 409);
  }
  return fail("table_payment_lock_failed", message || "Unable to update table payment lock.", 500);
}

export async function POST(req: Request, context: { params: Promise<{ tableId: string }> }) {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-table-payment-lock-ms", String(Date.now() - startedAt));
    return response;
  };

  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    await requirePosApiFeature(auth, "table_management");
    const { tableId } = await context.params;
    if (!tableId) return withTiming(fail("invalid_table_id", "tableId is required.", 422));

    const body = (await req.json().catch(() => ({}))) as PaymentLockPayload;
    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) return withTiming(fail("missing_order_id", "order_id is required.", 422));

    const locked = body.locked !== false;
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.rpc("set_table_payment_lock_tx", {
      p_tenant_id: auth.tenantId!,
      p_branch_id: auth.branchId!,
      p_table_id: tableId,
      p_order_id: orderId,
      p_locked: locked
    });

    if (error) return withTiming(mapPaymentLockError(error.message, error.code));

    const row = (Array.isArray(data) ? data[0] : data) as PaymentLockRow | null;
    if (!row) {
      return withTiming(fail("table_payment_lock_failed", "Payment lock did not return table state.", 500));
    }

    invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    return withTiming(ok({ table_id: row.table_id, order_id: row.order_id, status: row.status }));
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    return withTiming(
      mapPaymentLockError(error instanceof Error ? error.message : "Unable to update table payment lock.")
    );
  }
}
