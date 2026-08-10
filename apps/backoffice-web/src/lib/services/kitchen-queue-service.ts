import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type KitchenTicketStatus = "queued" | "acknowledged" | "preparing" | "ready" | "cancelled";
export type KitchenItemStatus = "queued" | "accepted" | "ready" | "cancelled";

const VALID_STATUSES = new Set<KitchenTicketStatus>(["queued", "acknowledged", "preparing", "ready", "cancelled"]);
const VALID_ITEM_TRANSITIONS = new Set<KitchenItemStatus>(["accepted", "ready"]);

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

function asItemStatus(value: unknown): KitchenItemStatus {
  if (value === "accepted" || value === "ready" || value === "cancelled") return value;
  return "queued";
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

  let ticketQuery = supabase
    .from("kitchen_tickets")
    .select("id,order_id,zone_id,event_key,event_type,status,queue_no,order_no,order_type,table_id,customer_name,order_notes,metadata,created_at,updated_at")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("status", statuses)
    .in("event_type", ["new", "add", "reprint"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (args.zoneId?.trim()) {
    ticketQuery = ticketQuery.eq("zone_id", args.zoneId.trim());
  }

  const { data: tickets, error: ticketError } = await ticketQuery;
  if (ticketError) throw new KitchenQueueError("kitchen_queue_query_failed", ticketError.message, 500);

  const ticketRows = (tickets ?? []) as Array<{
    id: string;
    order_id: string;
    zone_id: string;
    event_key: string;
    event_type: string;
    status: KitchenTicketStatus;
    queue_no: number | null;
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
  const tableIds = Array.from(new Set(ticketRows.map((ticket) => ticket.table_id).filter((value): value is string => Boolean(value))));

  if (ticketIds.length === 0) {
    return {
      tickets: [],
      summary: { queued: 0, acknowledged: 0, preparing: 0, ready: 0, cancelled: 0 }
    };
  }

  const [itemsResult, jobsResult, zonesResult, tablesResult] = await Promise.all([
    supabase
      .from("kitchen_ticket_items")
      .select("id,kitchen_ticket_id,order_item_id,product_id,action,product_name,category_name,quantity,notes,status,accepted_at,accepted_by,ready_at,ready_by,metadata,created_at,updated_at")
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
      .in("id", zoneIds),
    tableIds.length
      ? supabase
          .from("dining_tables")
          .select("id,table_code,table_name")
          .eq("tenant_id", args.tenantId)
          .eq("branch_id", args.branchId)
          .in("id", tableIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  for (const result of [itemsResult, jobsResult, zonesResult, tablesResult]) {
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

  const itemsByTicket = new Map<string, Array<Record<string, unknown>>>();
  for (const value of itemsResult.data ?? []) {
    const item = value as Record<string, unknown>;
    const ticketId = String(item.kitchen_ticket_id ?? "");
    if (!ticketId || item.action === "cancel") continue;
    const list = itemsByTicket.get(ticketId) ?? [];
    list.push({ ...item, status: asItemStatus(item.status) });
    itemsByTicket.set(ticketId, list);
  }

  const jobsByTicket = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const list = jobsByTicket.get(job.kitchen_ticket_id) ?? [];
    list.push(job);
    jobsByTicket.set(job.kitchen_ticket_id, list);
  }

  const zonesById = new Map(
    (zonesResult.data ?? []).map((zone) => [String((zone as { id: string }).id), zone as Record<string, unknown>])
  );
  const tablesById = new Map(
    (tablesResult.data ?? []).map((table) => [String((table as { id: string }).id), table as Record<string, unknown>])
  );
  const printersById = new Map((printersResult.data ?? []).map((printer) => [String((printer as { id: string }).id), printer]));

  const hydratedTickets = ticketRows
    .map((ticket) => {
      const zone = zonesById.get(ticket.zone_id) ?? null;
      if (!zone || zone.is_active === false || zone.kds_enabled === false) return null;
      const items = itemsByTicket.get(ticket.id) ?? [];
      if (items.length === 0) return null;
      return {
        ...ticket,
        zone,
        table: ticket.table_id ? tablesById.get(ticket.table_id) ?? null : null,
        items,
        print_jobs: (jobsByTicket.get(ticket.id) ?? []).map((job) => ({
          ...job,
          printer: job.printer_id ? printersById.get(job.printer_id) ?? null : null
        }))
      };
    })
    .filter((ticket): ticket is NonNullable<typeof ticket> => Boolean(ticket));

  const summary = { queued: 0, acknowledged: 0, preparing: 0, ready: 0, cancelled: 0 };
  for (const ticket of hydratedTickets) {
    summary[ticket.status] += 1;
  }

  return { tickets: hydratedTickets, summary };
}

export async function transitionKitchenItemStatus(args: {
  auth: AuthContext;
  itemId: string;
  status: KitchenItemStatus;
}) {
  if (!VALID_ITEM_TRANSITIONS.has(args.status)) {
    throw new KitchenQueueError("invalid_kitchen_item_status", "Kitchen item status must be accepted or ready.", 422);
  }
  if (!args.auth.tenantId || !args.auth.branchId) {
    throw new KitchenQueueError("missing_scope", "Tenant and branch scope are required.", 401);
  }

  const supabase = getSupabaseServiceClient();
  const { data: item, error: itemError } = await supabase
    .from("kitchen_ticket_items")
    .select("id,kitchen_ticket_id,status,action")
    .eq("tenant_id", args.auth.tenantId)
    .eq("branch_id", args.auth.branchId)
    .eq("id", args.itemId)
    .maybeSingle<{ id: string; kitchen_ticket_id: string; status: KitchenItemStatus; action: string }>();
  if (itemError) throw new KitchenQueueError("kitchen_item_query_failed", itemError.message, 500);
  if (!item || item.action === "cancel") throw new KitchenQueueError("kitchen_item_not_found", "Kitchen item was not found in this branch.", 404);

  const { data: ticket, error: ticketError } = await supabase
    .from("kitchen_tickets")
    .select("id,zone_id,status")
    .eq("tenant_id", args.auth.tenantId)
    .eq("branch_id", args.auth.branchId)
    .eq("id", item.kitchen_ticket_id)
    .maybeSingle<{ id: string; zone_id: string; status: KitchenTicketStatus }>();
  if (ticketError) throw new KitchenQueueError("kitchen_ticket_query_failed", ticketError.message, 500);
  if (!ticket) throw new KitchenQueueError("kitchen_ticket_not_found", "Kitchen ticket was not found in this branch.", 404);

  const { data: zone, error: zoneError } = await supabase
    .from("kitchen_zones")
    .select("id,kds_enabled,is_active")
    .eq("tenant_id", args.auth.tenantId)
    .eq("branch_id", args.auth.branchId)
    .eq("id", ticket.zone_id)
    .maybeSingle<{ id: string; kds_enabled: boolean; is_active: boolean }>();
  if (zoneError) throw new KitchenQueueError("kitchen_zone_query_failed", zoneError.message, 500);
  if (!zone || zone.is_active === false || zone.kds_enabled === false) {
    throw new KitchenQueueError("kitchen_kds_disabled", "Kitchen Display is disabled for this zone.", 409);
  }

  const currentStatus = asItemStatus(item.status);
  if (currentStatus === args.status) return item;
  if (currentStatus === "ready" || currentStatus === "cancelled") {
    throw new KitchenQueueError("kitchen_item_terminal", "This Kitchen item is already complete.", 409);
  }

  const expectedStatus: KitchenItemStatus = args.status === "accepted" ? "queued" : "accepted";
  if (currentStatus !== expectedStatus) {
    throw new KitchenQueueError(
      args.status === "ready" ? "kitchen_item_must_be_accepted" : "kitchen_item_transition_invalid",
      args.status === "ready" ? "Accept the order item before marking it ready." : "Kitchen item status transition is not allowed.",
      409
    );
  }

  const now = new Date().toISOString();
  const update = args.status === "accepted"
    ? { status: "accepted", accepted_at: now, accepted_by: args.auth.userId, updated_at: now }
    : { status: "ready", ready_at: now, ready_by: args.auth.userId, updated_at: now };
  const { data: updated, error: updateError } = await supabase
    .from("kitchen_ticket_items")
    .update(update)
    .eq("tenant_id", args.auth.tenantId)
    .eq("branch_id", args.auth.branchId)
    .eq("id", args.itemId)
    .eq("status", expectedStatus)
    .select("id,kitchen_ticket_id,status,accepted_at,accepted_by,ready_at,ready_by,updated_at")
    .maybeSingle();
  if (updateError) throw new KitchenQueueError("kitchen_item_status_failed", updateError.message, 500);
  if (!updated) {
    throw new KitchenQueueError("kitchen_item_transition_conflict", "Kitchen item changed on another screen. Refresh and try again.", 409);
  }

  void appendAuditLog({
    tenantId: args.auth.tenantId,
    branchId: args.auth.branchId,
    actorUserId: args.auth.userId,
    actorRole: args.auth.branchRole ?? args.auth.platformRole,
    action: "kitchen_item_status_changed",
    targetTable: "kitchen_ticket_items",
    targetId: args.itemId,
    metadata: { status: args.status, kitchen_ticket_id: item.kitchen_ticket_id }
  });

  return updated;
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
