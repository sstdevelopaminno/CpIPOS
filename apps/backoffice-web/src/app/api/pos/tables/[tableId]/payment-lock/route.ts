import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type PaymentLockPayload = {
  order_id?: string | null;
  locked?: boolean;
};

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

    const nextStatus = body.locked === false ? "ordering" : "pending_payment";
    const supabase = getSupabaseServiceClient();

    const { data: session, error: sessionError } = await supabase
      .from("table_bill_sessions")
      .select("id,status,order_id")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("table_id", tableId)
      .eq("order_id", orderId)
      .in("status", body.locked === false ? ["pending_payment"] : ["open", "ordering", "pending_payment"])
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; status: string; order_id: string | null }>();

    if (sessionError) return withTiming(fail("table_session_query_failed", sessionError.message, 500));
    if (!session) return withTiming(fail("table_session_not_open", "Active table bill session was not found for this order.", 404));

    if (session.status !== nextStatus) {
      const { error: updateSessionError } = await supabase
        .from("table_bill_sessions")
        .update({ status: nextStatus })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", session.id);
      if (updateSessionError) return withTiming(fail("table_session_update_failed", updateSessionError.message, 500));
    }

    const { error: updateTableError } = await supabase
      .from("dining_tables")
      .update({ status: nextStatus })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", tableId);
    if (updateTableError) return withTiming(fail("table_status_update_failed", updateTableError.message, 500));

    invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    return withTiming(ok({ table_id: tableId, order_id: orderId, status: nextStatus }));
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    return withTiming(fail("table_payment_lock_failed", error instanceof Error ? error.message : "Unable to update table payment lock.", 400));
  }
}