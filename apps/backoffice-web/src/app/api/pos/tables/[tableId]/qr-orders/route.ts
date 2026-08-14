import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function GET(request: Request, context: { params: Promise<{ tableId: string }> }) {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-table-qr-orders-ms", String(Date.now() - startedAt));
    return response;
  };
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:view" });
    await requirePosApiFeature(auth, "qr_table_ordering");
    const { tableId } = await context.params;
    const afterRaw = new URL(request.url).searchParams.get("after");
    if (!tableId) return withTiming(fail("invalid_table_id", "tableId is required.", 422));

    const after = afterRaw && !Number.isNaN(new Date(afterRaw).getTime()) ? new Date(afterRaw).toISOString() : null;
    const cacheKey = `pos-table-qr-orders:${auth.tenantId}:${auth.branchId}:${tableId}:${after ?? "recent"}`;
    const { value: payload, source: cacheSource } = await readThroughRuntimeCache({
      key: cacheKey,
      ttlMs: 2500,
      staleIfErrorMs: 10000,
      loader: async () => {
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
        if (after) {
          query = query.gt("created_at", after);
        } else {
          query = query.gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
        }

        const { data, error } = await query;
        if (error) throw new Error(`table_qr_orders_query_failed:${error.message}`);
        return { items: data ?? [], server_time: cursorBoundary };
      }
    });

    const response = ok(payload);
    response.headers.set("x-pos-table-qr-orders-cache", cacheSource);
    return withTiming(response);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    const message = error instanceof Error ? error.message : "Authentication failed.";
    if (message.startsWith("table_qr_orders_query_failed:")) {
      return withTiming(fail("table_qr_orders_query_failed", message.slice("table_qr_orders_query_failed:".length), 500));
    }
    return withTiming(fail("table_qr_orders_failed", message, 401));
  }
}
