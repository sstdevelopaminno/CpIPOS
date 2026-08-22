import "server-only";

import { randomUUID } from "node:crypto";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { invalidatePosBranchRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type KitchenTicketStatus = "queued" | "acknowledged" | "preparing" | "ready" | "cancelled";

const VALID_STATUSES = new Set<KitchenTicketStatus>(["queued", "acknowledged", "preparing", "ready", "cancelled"]);
const TERMINAL_ORDER_STATUSES = new Set(["completed", "cancelled"]);
const KITCHEN_TICKET_SELECT_WITH_ROUND = "id,order_id,zone_id,event_key,event_type,status,queue_no,round_no,order_no,order_type,table_id,customer_name,order_notes,metadata,created_at,updated_at";
const KITCHEN_TICKET_SELECT_BASE = "id,order_id,zone_id,event_key,event_type,status,queue_no,order_no,order_type,table_id,customer_name,order_notes,metadata,created_at,updated_at";

type KitchenTicketRow = {
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
};

function emptyKitchenQueue() {
  return { tickets: [], summary: { queued: 0, acknowledged: 0, preparing: 0, ready: 0, cancelled: 0 } };
}

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
    if (args.zoneId?.trim()) query = query.eq("zone_id", args.zoneId.trim());
    return query;
  };

  const ticketResult = await buildTicketQuery(KITCHEN_TICKET_SELECT_WITH_ROUND, true);
  let tickets = ticketResult.data as unknown[] | null;
  let ticketError = ticketResult.error;
  if (isMissingRoundNoError(ticketError)) {
    const fallback = await buildTicketQuery(KITCHEN_TICKET_SELECT_BASE, false);
    tickets = ((fallback.data ?? []) as unknown[]).map((ticket) => ({ ...(ticket as Record<string, unknown>), round_no: null }));
    ticketError = fallback.error;
  }
  if (ticketError) throw new KitchenQueueError("kitchen_queue_query_failed", ticketError.message, 500);

  const rawTicketRows = (tickets ?? []) as unknown as KitchenTicketRow[];
  if (rawTicketRows.length === 0) return emptyKitchenQueue();

  // A closed dine-in bill must never reappear after KDS is re-enabled. Keep
  // takeaway/delivery decoupled because those orders can be paid before cooking finishes.
  const orderIds = Array.from(new Set(rawTicketRows.map((ticket) => ticket.order_id).filter(Boolean)));
  const parentOrdersResult = await supabase
    .from("orders")
    .select("id,status,order_type")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("id", orderIds);
  if (parentOrdersResult.error) {
    throw new KitchenQueueError("kitchen_queue_parent_order_failed", parentOrdersResult.error.message, 500);
  }

  const liveOrderIds = new Set(
    (parentOrdersResult.data ?? [])
      .filter((order) => {
        const row = order as { status?: unknown; order_type?: unknown };
        const isClosedDineIn = String(row.order_type ?? "") === "dine_in"
          && TERMINAL_ORDER_STATUSES.has(String(row.status ?? ""));
        return !isClosedDineIn;
      })
      .map((order) => String((order as { id?: unknown }).id ?? ""))
      .filter(Boolean)
  );
  const ticketRows = rawTicketRows.filter((ticket) => liveOrderIds.has(ticket.order_id));
  if (ticketRows.length === 0) return emptyKitchenQueue();

  const ticketIds = ticketRows.map((ticket) => ticket.id);
  const zoneIds = Array.from(new Set(ticketRows.map((ticket) => ticket.zone_id)));
  const tableIds = Array.from(new Set(ticketRows.map((ticket) => ticket.table_id).filter((value): value is string => Boolean(value))));

  const [itemsResult, zonesResult, tablesResult] = await Promise.all([
    supabase
      .from("kitchen_ticket_items")
      .select("id,kitchen_ticket_id,order_item_id,product_id,action,product_name,category_name,quantity,notes,metadata,created_at")
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

  for (const result of [itemsResult, zonesResult, tablesResult]) {
    if (result.error) throw new KitchenQueueError("kitchen_queue_detail_failed", result.error.message, 500);
  }

  const itemsByTicket = new Map<string, unknown[]>();
  for (const item of itemsResult.data ?? []) {
    const row = item as { kitchen_ticket_id?: string; metadata?: Record<string, unknown> | null };
    if (row.metadata?.kds_line_cancelled === true) continue;
    const ticketId = String(row.kitchen_ticket_id ?? "");
    const list = itemsByTicket.get(ticketId) ?? [];
    list.push(item);
    itemsByTicket.set(ticketId, list);
  }

  const zonesById = new Map((zonesResult.data ?? []).map((zone) => [String((zone as { id: string }).id), zone]));
  const tableLabelsById = new Map(
    (tablesResult.data ?? []).map((table) => {
      const row = table as { id: string; table_code?: string | null; table_name?: string | null };
      return [String(row.id), String(row.table_code || row.table_name || row.id)] as const;
    })
  );

  const hydratedTickets = ticketRows.map((ticket) => ({
    ...ticket,
    table_uuid: ticket.table_id,
    table_id: ticket.table_id ? tableLabelsById.get(ticket.table_id) ?? ticket.table_id : null,
    zone: zonesById.get(ticket.zone_id) ?? null,
    items: itemsByTicket.get(ticket.id) ?? [],
    print_jobs: []
  }));

  const summary = { queued: 0, acknowledged: 0, preparing: 0, ready: 0, cancelled: 0 };
  for (const ticket of hydratedTickets) summary[ticket.status] += 1;
  return { tickets: hydratedTickets, summary };
}

function roundMoney(value: number) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

async function calculateDineInReplacementTotals(args: {
  tenantId: string;
  branchId: string;
  subtotal: number;
  discountAmount: number;
  gpAmount: number;
}) {
  const supabase = getSupabaseServiceClient();
  const baseAmount = Math.max(0, roundMoney(args.subtotal - args.discountAmount - args.gpAmount));
  let taxTotal = 0;
  const taxLines: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }> = [];

  const { data, error } = await supabase
    .from("tenant_tax_settings")
    .select("is_enabled,settings")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .limit(1)
    .maybeSingle<{ is_enabled: boolean | null; settings: { lines?: unknown[] } | null }>();
  if (error) throw new KitchenQueueError("kitchen_line_cancel_tax_failed", error.message, 500);

  if (data?.is_enabled === true && Array.isArray(data.settings?.lines)) {
    for (const rawLine of data.settings.lines) {
      if (!rawLine || typeof rawLine !== "object") continue;
      const line = rawLine as Record<string, unknown>;
      if (line.is_active === false) continue;
      const ratePct = Math.max(0, Number(line.rate_pct ?? 0));
      if (!Number.isFinite(ratePct) || ratePct <= 0) continue;
      const mode = String(line.mode ?? "add_to_bill");
      const amount = roundMoney(baseAmount * (ratePct / 100)) * (mode === "deduct_from_bill" ? -1 : 1);
      taxTotal = roundMoney(taxTotal + amount);
      taxLines.push({ id: String(line.id ?? randomUUID()), label: String(line.label ?? "Tax"), rate_pct: ratePct, mode, amount });
    }
  }

  return { subtotal: roundMoney(args.subtotal), tax_total: roundMoney(taxTotal), grand_total: roundMoney(Math.max(0, baseAmount + taxTotal)), tax_lines: taxLines };
}

export async function cancelKitchenTicketItem(args: {
  auth: AuthContext;
  ticketId: string;
  itemId: string;
  reason?: string | null;
}) {
  if (!args.auth.tenantId || !args.auth.branchId) throw new KitchenQueueError("missing_scope", "Tenant and branch scope are required.", 401);
  const ticketId = args.ticketId.trim();
  const itemId = args.itemId.trim();
  if (!ticketId || !itemId) throw new KitchenQueueError("invalid_kitchen_item", "Kitchen ticket and item are required.", 422);

  const supabase = getSupabaseServiceClient();
  const [{ data: ticket, error: ticketError }, { data: item, error: itemError }] = await Promise.all([
    supabase.from("kitchen_tickets").select("id,order_id,status,event_type,order_no,order_type,table_id").eq("tenant_id", args.auth.tenantId).eq("branch_id", args.auth.branchId).eq("id", ticketId).maybeSingle<{ id: string; order_id: string; status: KitchenTicketStatus; event_type: string; order_no: string; order_type: string; table_id: string | null }>(),
    supabase.from("kitchen_ticket_items").select("id,kitchen_ticket_id,order_item_id,action,metadata").eq("tenant_id", args.auth.tenantId).eq("branch_id", args.auth.branchId).eq("id", itemId).maybeSingle<{ id: string; kitchen_ticket_id: string; order_item_id: string | null; action: string; metadata: Record<string, unknown> | null }>()
  ]);
  if (ticketError) throw new KitchenQueueError("kitchen_ticket_query_failed", ticketError.message, 500);
  if (itemError) throw new KitchenQueueError("kitchen_ticket_item_query_failed", itemError.message, 500);
  if (!ticket || !item || item.kitchen_ticket_id !== ticket.id) throw new KitchenQueueError("kitchen_ticket_item_not_found", "Kitchen item was not found in this branch.", 404);
  if (ticket.status === "ready" || ticket.status === "cancelled") throw new KitchenQueueError("kitchen_ticket_terminal", "Kitchen ticket is already finished.", 409);
  if (!item.order_item_id) throw new KitchenQueueError("kitchen_item_order_line_missing", "Kitchen item is not linked to an order line.", 409);
  if (item.action === "cancel") throw new KitchenQueueError("kitchen_item_already_cancel_notice", "This Kitchen line is already a cancel notice.", 409);
  if (item.metadata?.kds_line_cancelled === true) return { ticket_id: ticket.id, item_id: item.id, order_id: ticket.order_id, duplicate: true };

  const [{ data: order, error: orderError }, { data: targetLine, error: targetError }, { data: itemRows, error: itemRowsError }] = await Promise.all([
    supabase.from("orders").select("id,order_no,status,order_type,shift_id,table_id,discount_amount,gp_amount").eq("tenant_id", args.auth.tenantId).eq("branch_id", args.auth.branchId).eq("id", ticket.order_id).maybeSingle<{ id: string; order_no: string; status: string; order_type: string; shift_id: string | null; table_id: string | null; discount_amount: number | null; gp_amount: number | null }>(),
    supabase.from("order_items").select("id,quantity,metadata").eq("tenant_id", args.auth.tenantId).eq("branch_id", args.auth.branchId).eq("id", item.order_item_id).maybeSingle<{ id: string; quantity: number | null; metadata: Record<string, unknown> | null }>(),
    supabase.from("order_items").select("id,product_id,quantity,unit_price,line_total,notes,metadata").eq("tenant_id", args.auth.tenantId).eq("branch_id", args.auth.branchId).eq("order_id", ticket.order_id)
  ]);
  if (orderError) throw new KitchenQueueError("kitchen_line_cancel_order_failed", orderError.message, 500);
  if (targetError) throw new KitchenQueueError("kitchen_line_cancel_target_failed", targetError.message, 500);
  if (itemRowsError) throw new KitchenQueueError("kitchen_line_cancel_items_failed", itemRowsError.message, 500);
  if (!order) throw new KitchenQueueError("order_not_found", "Order was not found in this branch.", 404);
  if (!targetLine) throw new KitchenQueueError("order_item_not_found", "Order line was not found in this branch.", 404);
  if (order.status !== "queued" || order.order_type !== "dine_in") throw new KitchenQueueError("order_not_editable", "Only active dine-in queued orders can be edited from Kitchen.", 409);
  if (!order.shift_id || !order.table_id) throw new KitchenQueueError("order_scope_incomplete", "Order is missing shift or table scope.", 409);

  const remaining = (itemRows ?? [])
    .filter((row) => String(row.id) !== item.order_item_id)
    .filter((row) => Number(row.quantity ?? 0) > 0)
    .filter((row) => String((row.metadata as Record<string, unknown> | null)?.bill_line_state ?? "") !== "cancelled")
    .map((row) => ({ product_id: String(row.product_id), quantity: Number(row.quantity ?? 0), unit_price: Number(row.unit_price ?? 0), notes: row.notes ? String(row.notes) : null, note: row.notes ? String(row.notes) : null, line_total: Number(row.line_total ?? 0) }));
  const subtotal = roundMoney(remaining.reduce((sum, row) => sum + roundMoney(row.quantity * row.unit_price), 0));
  const discountAmount = Math.min(subtotal, Math.max(0, Number(order.discount_amount ?? 0)));
  const gpAmount = Math.min(Math.max(0, subtotal - discountAmount), Math.max(0, Number(order.gp_amount ?? 0)));
  const totals = await calculateDineInReplacementTotals({ tenantId: args.auth.tenantId, branchId: args.auth.branchId, subtotal, discountAmount, gpAmount });

  const { error: rpcError } = await supabase.rpc("replace_queued_dine_in_order_tx", { p_tenant_id: args.auth.tenantId, p_branch_id: args.auth.branchId, p_shift_id: order.shift_id, p_actor_user_id: args.auth.userId, p_order_id: order.id, p_table_id: order.table_id, p_items: remaining, p_app_total_amount: totals.subtotal, p_discount_amount: discountAmount, p_gp_amount: gpAmount, p_tax_total: totals.tax_total, p_grand_total: totals.grand_total, p_tax_lines: totals.tax_lines });
  if (rpcError) throw new KitchenQueueError("kitchen_line_cancel_replace_failed", rpcError.message, 409);

  const cancelledQuantity = Math.max(0, Number(targetLine.quantity ?? item.metadata?.cancelled_quantity ?? 0));
  const nextMetadata = { ...(item.metadata ?? {}), kds_line_cancelled: true, kds_line_cancelled_at: new Date().toISOString(), kds_line_cancelled_by: args.auth.userId, kds_line_cancel_reason: args.reason?.trim()?.slice(0, 240) || "kitchen_item_cancelled", cancelled_quantity: cancelledQuantity, replacement_remaining_item_count: remaining.length };
  const { error: markError } = await supabase.from("kitchen_ticket_items").update({ metadata: nextMetadata }).eq("tenant_id", args.auth.tenantId).eq("branch_id", args.auth.branchId).eq("id", item.id);
  if (markError) throw new KitchenQueueError("kitchen_line_cancel_mark_failed", markError.message, 500);

  const { data: siblingItems, error: siblingError } = await supabase.from("kitchen_ticket_items").select("id,action,metadata").eq("tenant_id", args.auth.tenantId).eq("branch_id", args.auth.branchId).eq("kitchen_ticket_id", ticket.id);
  if (siblingError) throw new KitchenQueueError("kitchen_line_cancel_sibling_failed", siblingError.message, 500);
  const hasVisibleSibling = (siblingItems ?? []).some((row) => row.id !== item.id && row.action !== "cancel" && (row.metadata as Record<string, unknown> | null)?.kds_line_cancelled !== true);
  if (!hasVisibleSibling) await transitionKitchenTicketStatus({ auth: args.auth, ticketId: ticket.id, status: "cancelled" });

  void appendAuditLog({ tenantId: args.auth.tenantId, branchId: args.auth.branchId, actorUserId: args.auth.userId, actorRole: args.auth.branchRole ?? args.auth.platformRole, action: "kitchen_ticket_item_cancelled", targetTable: "kitchen_ticket_items", targetId: item.id, metadata: { order_id: order.id, ticket_id: ticket.id, order_item_id: item.order_item_id, remaining_item_count: remaining.length } });
  invalidatePosBranchRuntimeCaches({ tenantId: args.auth.tenantId, branchId: args.auth.branchId });

  return { ticket_id: ticket.id, item_id: item.id, order_id: order.id, duplicate: false, remaining_item_count: remaining.length, total_amount: totals.grand_total };
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
