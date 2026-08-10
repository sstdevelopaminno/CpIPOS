import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function GET(request: Request, context: { params: Promise<{ tableId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:view" });
    await requirePosApiFeature(auth, "qr_table_ordering");
    const { tableId } = await context.params;
    const after = new URL(request.url).searchParams.get("after");
    if (!tableId) return fail("invalid_table_id", "tableId is required.", 422);

    const supabase = getSupabaseServiceClient();
    const cursorBoundary = new Date().toISOString();
    let query = supabase
      .from("table_qr_orders")
      .select("id,event_type,order_id,table_session_id,item_count,subtotal,payload,created_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("table_id", tableId)
      .eq("event_type", "order")
      .lte("created_at", cursorBoundary)
      .order("created_at", { ascending: true })
      .limit(25);
    if (after && !Number.isNaN(new Date(after).getTime())) {
      query = query.gt("created_at", after);
    } else {
      query = query.gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
    }

    const { data, error } = await query;
    if (error) return fail("table_qr_orders_query_failed", error.message, 500);
    return ok({ items: data ?? [], server_time: cursorBoundary });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("table_qr_orders_failed", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
