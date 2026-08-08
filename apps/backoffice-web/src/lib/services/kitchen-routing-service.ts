import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type KitchenAction = "new" | "add" | "cancel" | "reprint";

type KitchenDispatchRow = {
  kitchen_ticket_id: string;
  zone_id: string;
  print_job_id: string | null;
};

export type KitchenDispatchResult =
  | {
      ok: true;
      eventKey: string;
      tickets: KitchenDispatchRow[];
      routedZoneCount: number;
      queuedPrintJobCount: number;
    }
  | {
      ok: false;
      eventKey: string;
      code: "kitchen_dispatch_failed";
      message: string;
    };

export async function dispatchOrderToKitchen(args: {
  tenantId: string;
  branchId: string;
  orderId: string;
  eventKey: string;
  action?: KitchenAction;
  orderItemIds?: string[] | null;
  actorUserId?: string | null;
  actorRole?: string | null;
}): Promise<KitchenDispatchResult> {
  const eventKey = args.eventKey.trim();
  if (!eventKey) {
    return {
      ok: false,
      eventKey,
      code: "kitchen_dispatch_failed",
      message: "Kitchen event key is required."
    };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("enqueue_kitchen_order", {
    p_tenant_id: args.tenantId,
    p_branch_id: args.branchId,
    p_order_id: args.orderId,
    p_event_key: eventKey,
    p_action: args.action ?? "new",
    p_order_item_ids: args.orderItemIds?.length ? args.orderItemIds : null
  });

  if (error) {
    if (args.actorUserId) {
      void appendAuditLog({
        tenantId: args.tenantId,
        branchId: args.branchId,
        actorUserId: args.actorUserId,
        actorRole: (args.actorRole ?? "staff") as "owner" | "manager" | "staff" | "accountant",
        action: "kitchen_dispatch_failed",
        targetTable: "orders",
        targetId: args.orderId,
        metadata: {
          event_key: eventKey,
          kitchen_action: args.action ?? "new",
          order_item_ids: args.orderItemIds ?? null,
          error: error.message
        }
      });
    }

    return {
      ok: false,
      eventKey,
      code: "kitchen_dispatch_failed",
      message: error.message
    };
  }

  const tickets = (Array.isArray(data) ? data : []) as KitchenDispatchRow[];

  if (args.actorUserId) {
    void appendAuditLog({
      tenantId: args.tenantId,
      branchId: args.branchId,
      actorUserId: args.actorUserId,
      actorRole: (args.actorRole ?? "staff") as "owner" | "manager" | "staff" | "accountant",
      action: "kitchen_dispatched",
      targetTable: "orders",
      targetId: args.orderId,
      metadata: {
        event_key: eventKey,
        kitchen_action: args.action ?? "new",
        order_item_ids: args.orderItemIds ?? null,
        routed_zone_count: tickets.length,
        queued_print_job_count: tickets.filter((row) => Boolean(row.print_job_id)).length
      }
    });
  }

  return {
    ok: true,
    eventKey,
    tickets,
    routedZoneCount: tickets.length,
    queuedPrintJobCount: tickets.filter((row) => Boolean(row.print_job_id)).length
  };
}
