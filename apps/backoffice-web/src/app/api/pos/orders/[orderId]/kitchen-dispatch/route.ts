import crypto from "node:crypto";

import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { dispatchOrderToKitchen } from "@/lib/services/kitchen-routing-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type KitchenAction = "new" | "add" | "cancel" | "reprint";

export async function POST(req: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sale:create" });
    const { orderId } = await context.params;
    if (!orderId) {
      return fail("invalid_order_id", "orderId is required.", 422);
    }

    const body = (await req.json().catch(() => ({}))) as {
      action?: KitchenAction;
      event_key?: string;
      order_item_ids?: string[];
    };
    const action: KitchenAction = body.action ?? "new";
    if (!["new", "add", "cancel", "reprint"].includes(action)) {
      return fail("invalid_kitchen_action", "Kitchen action must be new, add, cancel, or reprint.", 422);
    }

    const supabase = getSupabaseServiceClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", orderId)
      .maybeSingle<{ id: string }>();

    if (orderError) {
      return fail("order_query_failed", orderError.message, 500);
    }
    if (!order) {
      return fail("order_not_found", "Order was not found in the active branch.", 404);
    }

    const requestedItemIds = Array.from(
      new Set((body.order_item_ids ?? []).map((value) => String(value).trim()).filter(Boolean))
    );
    if (requestedItemIds.length > 0) {
      const { data: scopedItems, error: itemError } = await supabase
        .from("order_items")
        .select("id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("order_id", orderId)
        .in("id", requestedItemIds);
      if (itemError) {
        return fail("order_items_query_failed", itemError.message, 500);
      }
      if ((scopedItems ?? []).length !== requestedItemIds.length) {
        return fail("invalid_order_item_ids", "One or more order item IDs do not belong to this order.", 422);
      }
    }

    const eventKey =
      body.event_key?.trim() ||
      req.headers.get("x-idempotency-key")?.trim() ||
      `${orderId}:${action}:${crypto.randomUUID()}`;

    const result = await dispatchOrderToKitchen({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!,
      orderId,
      eventKey,
      action,
      orderItemIds: requestedItemIds.length > 0 ? requestedItemIds : null,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole
    });

    if (!result.ok) {
      return fail(result.code, `${result.message} (event: ${result.eventKey})`, 500);
    }

    return ok({
      event_key: result.eventKey,
      routed_zone_count: result.routedZoneCount,
      queued_print_job_count: result.queuedPrintJobCount,
      tickets: result.tickets
    });
  } catch (error) {
    return fail("kitchen_dispatch_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}
