import { resolveQrKitchenHardeningFlags } from "@/lib/fg0003-qr-kitchen-hardening";
import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { reviewPendingTableQrOrder } from "@/lib/table-qr-ordering";

export async function GET(request: Request, context: { params: Promise<{ tableId: string }> }) {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-table-qr-orders-ms", String(Date.now() - startedAt));
    return response;
  };
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:view" });
    await requirePosApiFeature(auth, "qr_table_ordering");
    const flags = resolveQrKitchenHardeningFlags({ tenantId: auth.tenantId, branchId: auth.branchId });
    const fg0003PendingOnly = flags.qr_pos_review_required;
    const { tableId } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const afterRaw = searchParams.get("after");
    const forceRefresh = searchParams.get("refresh") === "1";
    if (!tableId) return withTiming(fail("invalid_table_id", "tableId is required.", 422));

    const after = afterRaw && !Number.isNaN(new Date(afterRaw).getTime()) ? new Date(afterRaw).toISOString() : null;
    const cacheKey = `pos-table-qr-orders:${auth.tenantId}:${auth.branchId}:${tableId}:${fg0003PendingOnly ? "pending-fifo-v2" : "all"}:${after ?? "recent"}`;
    const { value: payload, source: cacheSource } = await readThroughRuntimeCache({
      key: cacheKey,
      // Keep FG0003 nearly real-time without forcing every 2-3s poll to hit Postgres.
      ttlMs: fg0003PendingOnly ? 350 : 2500,
      staleIfErrorMs: 10000,
      forceRefresh,
      loader: async () => {
        const supabase = getSupabaseServiceClient();
        const cursorBoundary = new Date().toISOString();
        let query = supabase
          .from("table_qr_orders")
          .select("id,event_type,order_id,table_session_id,item_count,subtotal,payload,review_status,created_at")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("table_id", tableId)
          .eq("event_type", "order")
          .lte("created_at", cursorBoundary)
          .order("created_at", { ascending: true })
          .limit(fg0003PendingOnly ? 1 : 25);
        if (fg0003PendingOnly) {
          // FG0003 is an acknowledgement queue. Keep returning the oldest pending
          // submission until staff accepts/rejects it; newer submissions must wait.
          query = query.eq("review_status", "pending_pos_review");
        } else if (after) {
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

export async function POST(request: Request, context: { params: Promise<{ tableId: string }> }) {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-table-qr-review-ms", String(Date.now() - startedAt));
    return response;
  };
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:manage" });
    await requirePosApiFeature(auth, "qr_table_ordering");
    const { tableId } = await context.params;
    if (!tableId) return withTiming(fail("invalid_table_id", "tableId is required.", 422));
    const body = (await request.json().catch(() => null)) as {
      submission_id?: string;
      action?: "accept" | "reject";
      request_id?: string;
      accepted_item_indexes?: number[] | null;
    } | null;
    const submissionId = String(body?.submission_id ?? "").trim();
    const action = body?.action;
    const requestId = String(body?.request_id ?? request.headers.get("x-idempotency-key") ?? crypto.randomUUID()).trim();
    if (!submissionId) return withTiming(fail("missing_submission_id", "submission_id is required.", 422));
    if (action !== "accept" && action !== "reject") return withTiming(fail("invalid_review_action", "action must be accept or reject.", 422));

    const result = await reviewPendingTableQrOrder({
      auth,
      tableId,
      submissionId,
      action,
      requestId,
      acceptedItemIndexes: Array.isArray(body?.accepted_item_indexes) ? body.accepted_item_indexes : null
    });
    return withTiming(ok(result));
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    const message = error instanceof Error ? error.message : "Unable to review QR order.";
    if (message === "QR_REVIEW_SUBMISSION_NOT_FOUND") return withTiming(fail("qr_review_submission_not_found", "QR submission was not found for this table.", 404));
    if (message === "QR_REVIEW_NOT_PENDING" || message === "QR_REVIEW_CONFIRM_IN_PROGRESS") return withTiming(fail("qr_review_not_pending", "QR submission is no longer pending review.", 409));
    return withTiming(fail("qr_review_failed", message, 400));
  }
}
