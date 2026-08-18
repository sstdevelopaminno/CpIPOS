import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { queueRoutedKitchenTicketPrint } from "@/lib/printing/routed-print-service";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

type KitchenAction = "new" | "add" | "cancel" | "reprint";

type KitchenDispatchRow = {
  kitchen_ticket_id: string;
  zone_id: string;
  print_job_id: string | null;
  queue_no?: number | null;
  round_no?: number | null;
};

type KitchenTicketRow = {
  id: string;
  zone_id: string | null;
  queue_no: number | null;
  round_no: number | null;
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

const KITCHEN_PRINT_TICKET_SELECT_WITH_ROUND = "id,zone_id,queue_no,round_no";
const KITCHEN_PRINT_TICKET_SELECT_BASE = "id,zone_id,queue_no";

function isMissingRoundNoError(error: { message?: string } | null | undefined) {
  return Boolean(error?.message?.includes("kitchen_tickets.round_no") || error?.message?.includes("round_no does not exist"));
}

function normalizeBranchRole(role?: string | null): AuthContext["branchRole"] {
  if (role === "owner" || role === "manager" || role === "staff" || role === "accountant") return role;
  return "staff";
}

function makePrintAuth(args: { tenantId: string; branchId: string; actorUserId?: string | null; actorRole?: string | null }): AuthContext | null {
  if (!args.actorUserId) return null;
  return {
    userId: args.actorUserId,
    tenantId: args.tenantId,
    branchId: args.branchId,
    branchRole: normalizeBranchRole(args.actorRole),
    platformRole: "tenant_user"
  };
}

async function loadKitchenTicketRowsForOrder(args: { tenantId: string; branchId: string; orderId: string }) {
  const supabase = getRoutedSupabaseServiceClient();
  const ticketQuery = (selectColumns: string) => supabase
    .from("kitchen_tickets")
    .select(selectColumns)
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("order_id", args.orderId)
    .order("created_at", { ascending: true });

  const ticketResult = await ticketQuery(KITCHEN_PRINT_TICKET_SELECT_WITH_ROUND);
  let tickets = ticketResult.data as unknown[] | null;
  let ticketError = ticketResult.error;
  if (isMissingRoundNoError(ticketError)) {
    const fallback = await ticketQuery(KITCHEN_PRINT_TICKET_SELECT_BASE);
    tickets = ((fallback.data ?? []) as unknown[]).map((ticket) => ({ ...(ticket as Record<string, unknown>), round_no: null }));
    ticketError = fallback.error;
  }
  if (ticketError) throw new Error(ticketError.message);
  return (tickets ?? []) as unknown as KitchenTicketRow[];
}

export async function queueMissingKitchenPrintJobsForOrder(args: {
  auth: AuthContext;
  orderId: string;
  runtimeDeviceCode?: string | null;
}) {
  if (!args.auth.tenantId || !args.auth.branchId) throw new Error("missing_scope");
  const supabase = getRoutedSupabaseServiceClient();
  const ticketRows = await loadKitchenTicketRowsForOrder({
    tenantId: args.auth.tenantId,
    branchId: args.auth.branchId,
    orderId: args.orderId
  });
  if (ticketRows.length === 0) return { ticketCount: 0, queuedPrintJobCount: 0, skippedExistingPrintJobCount: 0 };

  const ticketIds = ticketRows.map((ticket) => ticket.id);
  const { data: existingJobs, error: jobError } = await supabase
    .from("print_jobs")
    .select("kitchen_ticket_id")
    .eq("tenant_id", args.auth.tenantId)
    .eq("branch_id", args.auth.branchId)
    .in("kitchen_ticket_id", ticketIds);
  if (jobError) throw new Error(jobError.message);

  const ticketsWithJobs = new Set(((existingJobs ?? []) as Array<{ kitchen_ticket_id?: string | null }>).map((job) => String(job.kitchen_ticket_id ?? "")).filter(Boolean));
  const printAuth = args.auth;

  let queuedPrintJobCount = 0;
  for (const ticket of ticketRows) {
    if (ticketsWithJobs.has(ticket.id)) continue;
    const jobs = await queueRoutedKitchenTicketPrint({
      auth: printAuth,
      kitchenTicketId: ticket.id,
      runtimeDeviceCode: args.runtimeDeviceCode ?? null
    });
    queuedPrintJobCount += jobs.length;
    if (jobs.length > 0 && args.auth.userId) {
      void appendAuditLog({
        tenantId: args.auth.tenantId,
        branchId: args.auth.branchId,
        actorUserId: args.auth.userId,
        actorRole: printAuth.branchRole ?? "staff",
        action: "kitchen_print_queued",
        targetTable: "kitchen_tickets",
        targetId: ticket.id,
        metadata: {
          source: "queue_missing_kitchen_print_jobs",
          order_id: args.orderId,
          zone_id: ticket.zone_id,
          queue_no: ticket.queue_no,
          round_no: ticket.round_no,
          print_job_count: jobs.length
        }
      });
    }
  }

  return {
    ticketCount: ticketRows.length,
    queuedPrintJobCount,
    skippedExistingPrintJobCount: ticketsWithJobs.size
  };
}

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

  const action = args.action ?? "new";
  const printAuth = makePrintAuth(args);

  // Order-item insertion already creates Kitchen Tickets atomically in the database.
  // A later POS/API retry must repair missing print jobs on those authoritative tickets,
  // not create another ticket batch with a different event key.
  if (action === "new" && !args.orderItemIds?.length && printAuth) {
    try {
      const repair = await queueMissingKitchenPrintJobsForOrder({
        auth: printAuth,
        orderId: args.orderId
      });
      if (repair.ticketCount > 0) {
        const existingTickets = await loadKitchenTicketRowsForOrder({
          tenantId: args.tenantId,
          branchId: args.branchId,
          orderId: args.orderId
        });
        const tickets: KitchenDispatchRow[] = existingTickets.map((ticket) => ({
          kitchen_ticket_id: ticket.id,
          zone_id: ticket.zone_id ?? "",
          print_job_id: null,
          queue_no: ticket.queue_no,
          round_no: ticket.round_no
        }));

        void appendAuditLog({
          tenantId: args.tenantId,
          branchId: args.branchId,
          actorUserId: args.actorUserId!,
          actorRole: normalizeBranchRole(args.actorRole),
          action: "kitchen_dispatched",
          targetTable: "orders",
          targetId: args.orderId,
          metadata: {
            source: "existing_ticket_print_repair",
            event_key: eventKey,
            kitchen_action: action,
            order_item_ids: null,
            routed_zone_count: tickets.length,
            queued_print_job_count: repair.queuedPrintJobCount,
            skipped_existing_print_job_count: repair.skippedExistingPrintJobCount
          }
        });

        return {
          ok: true,
          eventKey,
          tickets,
          routedZoneCount: tickets.length,
          queuedPrintJobCount: repair.queuedPrintJobCount
        };
      }
    } catch (repairError) {
      const message = repairError instanceof Error ? repairError.message : "kitchen_preflight_repair_failed";
      void appendAuditLog({
        tenantId: args.tenantId,
        branchId: args.branchId,
        actorUserId: args.actorUserId!,
        actorRole: normalizeBranchRole(args.actorRole),
        action: "kitchen_dispatch_failed",
        targetTable: "orders",
        targetId: args.orderId,
        metadata: {
          source: "existing_ticket_print_repair",
          event_key: eventKey,
          kitchen_action: action,
          error: message
        }
      });
      return {
        ok: false,
        eventKey,
        code: "kitchen_dispatch_failed",
        message
      };
    }
  }

  const supabase = getRoutedSupabaseServiceClient();
  const { data, error } = await supabase.rpc("enqueue_kitchen_order", {
    p_tenant_id: args.tenantId,
    p_branch_id: args.branchId,
    p_order_id: args.orderId,
    p_event_key: eventKey,
    p_action: action,
    p_order_item_ids: args.orderItemIds?.length ? args.orderItemIds : null
  });

  if (error) {
    if (args.actorUserId) {
      void appendAuditLog({
        tenantId: args.tenantId,
        branchId: args.branchId,
        actorUserId: args.actorUserId,
        actorRole: normalizeBranchRole(args.actorRole),
        action: "kitchen_dispatch_failed",
        targetTable: "orders",
        targetId: args.orderId,
        metadata: {
          event_key: eventKey,
          kitchen_action: action,
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
  let queuedPrintJobCount = tickets.filter((row) => Boolean(row.print_job_id)).length;

  if (tickets.length > 0 && printAuth) {
    for (const ticket of tickets) {
      try {
        const jobs = await queueRoutedKitchenTicketPrint({
          auth: printAuth,
          kitchenTicketId: ticket.kitchen_ticket_id,
          forceReprint: action === "reprint"
        });
        queuedPrintJobCount += jobs.length;
        if (jobs.length > 0) {
          void appendAuditLog({
            tenantId: args.tenantId,
            branchId: args.branchId,
            actorUserId: args.actorUserId!,
            actorRole: printAuth.branchRole ?? "staff",
            action: "kitchen_print_queued",
            targetTable: "kitchen_tickets",
            targetId: ticket.kitchen_ticket_id,
            metadata: {
              event_key: eventKey,
              zone_id: ticket.zone_id,
              queue_no: ticket.queue_no ?? null,
              round_no: ticket.round_no ?? null,
              print_job_count: jobs.length
            }
          });
        }
      } catch (printError) {
        void appendAuditLog({
          tenantId: args.tenantId,
          branchId: args.branchId,
          actorUserId: args.actorUserId!,
          actorRole: printAuth.branchRole ?? "staff",
          action: "kitchen_print_failed",
          targetTable: "kitchen_tickets",
          targetId: ticket.kitchen_ticket_id,
          metadata: {
            event_key: eventKey,
            zone_id: ticket.zone_id,
            error: printError instanceof Error ? printError.message : "kitchen_print_failed"
          }
        });
      }
    }
  }

  if (args.actorUserId) {
    void appendAuditLog({
      tenantId: args.tenantId,
      branchId: args.branchId,
      actorUserId: args.actorUserId,
      actorRole: normalizeBranchRole(args.actorRole),
      action: "kitchen_dispatched",
      targetTable: "orders",
      targetId: args.orderId,
      metadata: {
        event_key: eventKey,
        kitchen_action: action,
        order_item_ids: args.orderItemIds ?? null,
        routed_zone_count: tickets.length,
        queued_print_job_count: queuedPrintJobCount
      }
    });
  }

  return {
    ok: true,
    eventKey,
    tickets,
    routedZoneCount: tickets.length,
    queuedPrintJobCount
  };
}
