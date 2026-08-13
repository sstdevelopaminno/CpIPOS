import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type KitchenTicketStatus = "queued" | "acknowledged" | "preparing" | "ready" | "cancelled";

const VALID_STATUSES = new Set<KitchenTicketStatus>(["queued", "acknowledged", "preparing", "ready", "cancelled"]);

const KITCHEN_TICKET_SELECT_WITH_ROUND = "id,order_id,zone_id,event_key,event_type,status,queue_no,round_no,order_no,order_type,table_id,customer_name,order_notes,metadata,created_at,updated_at";
const KITCHEN_TICKET_SELECT_BASE = "id,order_id,zone_id,event_key,event_type,status,queue_no,order_no,order_type,table_id,customer_name,order_notes,metadata,created_at,updated_at";

function isMissingRoundNoError(error: { message?: string } | null | undefined) {
  return Boolean(error?.message?.includes("kitchen_tickets.round_no") || error?.message?.includes("round_no does not exist"));
}
export class KitchenQueueError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "KitchenQueueError";
    this.code = code;
    this.status = status;
  }
}

export function parseKitchenStatuses(values: string[]): KitchenTicketStatus[] {
  const statuses = Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)));
  if (statuses.some((status) => !VALID_STATUSES.has(status as KitchenTicketStatus))) {
    throw new KitchenQueueError("invalid_kitchen_status", "Unsupported Kitchen ticket status.", 422);
  }
  return statuses as KitchenTicketStatus[];
}

export async function loadKitchenQueue(args: {
  tenantId: string;
  branchId: string;
  statuses?: KitchenTicketStatus[];
  zoneId?: string | null;
  limit?: number;
}) {
  const supabase = getSupabaseServiceClient();
  const statuses = args.statuses?.length ? args.statuses : (["queued", "acknowledged", "preparing"] as KitchenTicketStatus[]);
  const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 60)));

  const buildTicketQuery = (selectColumns: string, includeRoundNo: boolean) => {
    let query = supabase
      .from("kitchen_tickets")
      .select(selectColumns)
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("status", statuses)
      .order("queue_no", { ascending: true });

    if (includeRoundNo) query = query.order("round_no", { ascending: true });
    query = query.order("created_at", { ascending: true }).limit(limit);

    if (args.zoneId?.trim()) {
      query = query.eq("zone_id", args.zoneId.trim());
    }
    return query;
  };

  let ticketResult = await buildTicketQuery(KITCHEN_TICKET_SELECT_WITH_ROUND, true);
  if (isMissingRoundNoError(ticketResult.error)) {
    const fallback = await buildTicketQuery(KITCHEN_TICKET_SELECT_BASE, false);
    ticketResult = {
      data: (fallback.data ?? []).map((ticket) => ({ ...ticket, round_no: null })),
      error: fallback.error
    };
  }

  const { data: tickets, error: ticketError } = ticketResult;
  if (ticketError) throw new KitchenQueueError("kitchen_queue_query_failed", ticketError.message, 500);

  const ticketRows = (tickets ?? []) as Array<{
    id: string;
    order_id: string;
    zone_id: string;
    event_key: string;
    event_type: string;
    status: KitchenTicketStatus;
    queue_no: number | null;
    round_no: number | null;
    order_no: string;
    order_type: string;
    table_id: string | null;
    customer_name: string | null;
    order_notes: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>;
  const ticketIds = ticketRows.map((ticket) => ticket.id);
  const zoneIds = Array.from(new Set(ticketRows.map((ticket) => ticket.zone_id)));

  if (ticketIds.length === 0) {
    return {
      tickets: [],
      summary: { queued: 0, acknowledged: 0, preparing: 0, ready: 0, cancelled: 0 }
    };
  }

  const [itemsResult, jobsResult, zonesResult] = await Promise.all([
    supabase
      .from("kitchen_ticket_items")
      .select("id,kitchen_ticket_id,order_item_id,product_id,action,product_name,category_name,quantity,notes,metadata,created_at")
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("kitchen_ticket_id", ticketIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("print_jobs")
      .select("id,kitchen_ticket_id,printer_id,status,retry_count,max_retry_count,last_error,printed_at,failed_at,created_at")
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("kitchen_ticket_id", ticketIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("kitchen_zones")
      .select("id,zone_code,zone_name,display_order,is_active,kds_enabled,default_printer_id")
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("id", zoneIds)
  ]);

  for (const result of [itemsResult, jobsResult, zonesResult]) {
    if (result.error) throw new KitchenQueueError("kitchen_queue_detail_failed", result.error.message, 500);
  }

  const jobs = (jobsResult.data ?? []) as Array<{
    id: string;
    kitchen_ticket_id: string;
    printer_id: string | null;
    status: string;
    retry_count: number;
    max_retry_count: number;
    last_error: string | null;
    printed_at: string | null;
    failed_at: string | null;
    created_at: string;
  }>;
  const printerIds = Array.from(new Set(jobs.map((job) => job.printer_id).filter((value): value is string => Boolean(value))));
  const printersResult = printerIds.length
    ? await supabase
        .from("printer_profiles")
        .select("id,printer_name,connection_type,ip_address,port,paper_width_mm,enabled")
        .eq("tenant_id", args.tenantId)
        .eq("branch_id", args.branchId)
        .in("id", printerIds)
    : { data: [], error: null };
  if (printersResult.error) throw new KitchenQueueError("kitchen_printer_query_failed", printersResult.error.message, 500);

  const itemsByTicket = new Map<string, unknown[]>();
  for (const item of itemsResult.data ?? []) {
    const ticketId = String((item as { kitchen_ticket_id?: string }).kitchen_ticket_id ?? "");
    const list = itemsByTicket.get(ticketId) ?? [];
    list.push(item);
    itemsByTicket.set(ticketId, list);
  }

  const jobsByTicket = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const list = jobsByTicket.get(job.kitchen_ticket_id) ?? [];
    list.push(job);
    jobsByTicket.set(job.kitchen_ticket_id, list);
  }

  const zonesById = new Map((zonesResult.data ?? []).map((zone) => [String((zone as { id: string }).id), zone]));
  const printersById = new Map((printersResult.data ?? []).map((printer) => [String((printer as { id: string }).id), printer]));

  const hydratedTickets = ticketRows.map((ticket) => ({
    ...ticket,
    zone: zonesById.get(ticket.zone_id) ?? null,
    items: itemsByTicket.get(ticket.id) ?? [],
    print_jobs: (jobsByTicket.get(ticket.id) ?? []).map((job) => ({
      ...job,
      printer: job.printer_id ? printersById.get(job.printer_id) ?? null : null
    }))
  }));

  const summary = { queued: 0, acknowledged: 0, preparing: 0, ready: 0, cancelled: 0 };
  for (const ticket of hydratedTickets) {
    summary[ticket.status] += 1;
  }

  return { tickets: hydratedTickets, summary };
}

export async function transitionKitchenTicketStatus(args: {
  auth: AuthContext;
  ticketId: string;
  status: KitchenTicketStatus;
}) {
  if (!VALID_STATUSES.has(args.status)) {
    throw new KitchenQueueError("invalid_kitchen_status", "Unsupported Kitchen ticket status.", 422);
  }
  if (!args.auth.tenantId || !args.auth.branchId) {
    throw new KitchenQueueError("missing_scope", "Tenant and branch scope are required.", 401);
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("set_kitchen_ticket_status", {
    p_tenant_id: args.auth.tenantId,
    p_branch_id: args.auth.branchId,
    p_ticket_id: args.ticketId,
    p_status: args.status
  });
  if (error) {
    const message = error.message || "Kitchen ticket status update failed.";
    let status = 500;
    if (message.includes("NOT_FOUND")) status = 404;
    else if (message.includes("INVALID")) status = 422;
    else if (message.includes("TERMINAL") || message.includes("TRANSITION")) status = 409;
    throw new KitchenQueueError("kitchen_ticket_status_failed", message, status);
  }

  const row = Array.isArray(data) ? data[0] ?? null : data;
  if (!row) throw new KitchenQueueError("kitchen_ticket_status_failed", "Kitchen ticket status update returned no row.", 500);

  void appendAuditLog({
    tenantId: args.auth.tenantId,
    branchId: args.auth.branchId,
    actorUserId: args.auth.userId,
    actorRole: args.auth.branchRole ?? args.auth.platformRole,
    action: "kitchen_ticket_status_changed",
    targetTable: "kitchen_tickets",
    targetId: args.ticketId,
    metadata: { status: args.status }
  });

  return row;
}
