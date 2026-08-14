import type { BranchRole, PlatformRole, TableStatus } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type AuditFn = (input: {
  tenantId?: string;
  branchId?: string;
  actorUserId: string;
  actorRole: BranchRole | PlatformRole;
  action: string;
  targetTable: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<unknown>;

type TableLookupRow = {
  id: string;
  table_code: string;
  table_name: string | null;
  status: TableStatus;
  is_active: boolean;
};

type OpenSessionRow = {
  id: string;
  table_id: string;
  status: "open" | "ordering" | "pending_payment" | "closed" | "cancelled";
  order_id: string | null;
  opened_at: string;
};

type OpenBillSessionPerf = {
  table_lookup_ms?: number;
  active_session_check_ms?: number;
  insert_session_ms?: number;
  update_table_status_ms?: number;
  rollback_session_delete_ms?: number;
};

type OpenBillSessionSuccess = {
  ok: true;
  data: {
    id: string;
    table_id: string;
    table_code: string;
    table_name: string | null;
    status: "open" | "ordering" | "pending_payment" | "closed" | "cancelled";
    opened_at: string;
  };
  perf: OpenBillSessionPerf;
};

type OpenBillSessionFailure = {
  ok: false;
  code: string;
  message: string;
  status: number;
  perf: OpenBillSessionPerf;
};

const TERMINAL_ORDER_STATUSES = new Set(["paid", "closed", "cleared", "cancelled", "completed"]);

export async function openTableBillSession(args: {
  auth: AuthContext;
  tableId: string;
  metadata?: Record<string, unknown>;
  appendAudit?: AuditFn;
  supabaseClient?: ReturnType<typeof getSupabaseServiceClient>;
}) {
  const { auth, tableId, metadata = {}, appendAudit = appendAuditLog } = args;
  const perf: OpenBillSessionPerf = {};
  const markStep = (step: keyof OpenBillSessionPerf, startedAt: number) => {
    perf[step] = Date.now() - startedAt;
  };
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", message: "Missing tenant/branch scope.", status: 401, perf } satisfies OpenBillSessionFailure;
  }

  const supabase = args.supabaseClient ?? getSupabaseServiceClient();
  const tableLookupStartedAt = Date.now();
  const tableResult = await supabase
    .from("dining_tables")
    .select("id,table_code,table_name,status,is_active")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", tableId)
    .maybeSingle<TableLookupRow>();
  markStep("table_lookup_ms", tableLookupStartedAt);
  const { data: tableRow, error: tableError } = tableResult;

  if (tableError) {
    return { ok: false as const, code: "table_query_failed", message: tableError.message, status: 500, perf } satisfies OpenBillSessionFailure;
  }

  if (!tableRow) {
    return { ok: false as const, code: "table_not_found", message: "Table not found in current branch.", status: 404, perf } satisfies OpenBillSessionFailure;
  }

  if (!tableRow.is_active || tableRow.status === "disabled") {
    return { ok: false as const, code: "table_disabled", message: "Disabled table cannot open bill.", status: 409, perf } satisfies OpenBillSessionFailure;
  }

  if (tableRow.status === "reserved") {
    return { ok: false as const, code: "table_reserved", message: "Reserved table cannot open bill.", status: 409, perf } satisfies OpenBillSessionFailure;
  }

  if (tableRow.status === "occupied" || tableRow.status === "ordering" || tableRow.status === "pending_payment") {
    return {
      ok: false as const,
      code: "table_already_occupied",
      message: "This table already has an active bill session.",
      status: 409,
      perf
    } satisfies OpenBillSessionFailure;
  }

  const activeSessionCheckStartedAt = Date.now();
  const { data: activeSession, error: activeSessionError } = await supabase
    .from("table_bill_sessions")
    .select("id,status")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("table_id", tableId)
    .in("status", ["open", "ordering", "pending_payment"])
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: OpenSessionRow["status"] }>();
  markStep("active_session_check_ms", activeSessionCheckStartedAt);

  if (activeSessionError) {
    return { ok: false as const, code: "active_session_query_failed", message: activeSessionError.message, status: 500, perf } satisfies OpenBillSessionFailure;
  }

  if (activeSession) {
    return {
      ok: false as const,
      code: "table_already_occupied",
      message: "This table already has an active bill session.",
      status: 409,
      perf
    } satisfies OpenBillSessionFailure;
  }

  const insertSessionStartedAt = Date.now();
  const { data: sessionRow, error: insertError } = await supabase
    .from("table_bill_sessions")
    .insert({
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      table_id: tableId,
      opened_by: auth.userId,
      status: "open",
      order_id: null,
      metadata
    })
    .select("id,table_id,status,order_id,opened_at")
    .single<OpenSessionRow>();
  markStep("insert_session_ms", insertSessionStartedAt);

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: false as const,
        code: "table_already_occupied",
        message: "This table already has an active bill session.",
        status: 409,
        perf
      } satisfies OpenBillSessionFailure;
    }
    return { ok: false as const, code: "open_session_failed", message: insertError.message, status: 500, perf } satisfies OpenBillSessionFailure;
  }

  const updateTableStatusStartedAt = Date.now();
  const { error: tableStatusError } = await supabase
    .from("dining_tables")
    .update({ status: "occupied" })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", tableId);
  markStep("update_table_status_ms", updateTableStatusStartedAt);
  if (tableStatusError) {
    const rollbackDeleteStartedAt = Date.now();
    await supabase
      .from("table_bill_sessions")
      .delete()
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", sessionRow.id);
    markStep("rollback_session_delete_ms", rollbackDeleteStartedAt);
    return {
      ok: false as const,
      code: "table_status_update_failed",
      message: tableStatusError.message,
      status: 500,
      perf
    } satisfies OpenBillSessionFailure;
  }

  void appendAudit({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: "bill_opened_from_table",
    targetTable: "table_bill_sessions",
    targetId: sessionRow.id,
    metadata: {
      table_id: tableId,
      table_code: tableRow.table_code
    }
  });

  return {
    ok: true as const,
    data: {
      id: sessionRow.id,
      table_id: tableId,
      table_code: tableRow.table_code,
      table_name: tableRow.table_name,
      status: sessionRow.status,
      opened_at: sessionRow.opened_at
    },
    perf
  } satisfies OpenBillSessionSuccess;
}

export async function attachOrderToTableSession(args: {
  auth: AuthContext;
  tableId: string;
  orderId: string;
  orderNo: string;
  supabaseClient?: ReturnType<typeof getSupabaseServiceClient>;
}) {
  const { auth, tableId, orderId, orderNo } = args;
  if (!auth.tenantId || !auth.branchId) {
    return;
  }

  const supabase = args.supabaseClient ?? getSupabaseServiceClient();
  const { data: activeSession } = await supabase
    .from("table_bill_sessions")
    .select("id,order_id,metadata,opened_at")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("table_id", tableId)
    .in("status", ["open", "ordering", "pending_payment"])
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; order_id: string | null; metadata: Record<string, unknown> | null; opened_at: string }>();

  if (!activeSession) {
    return;
  }
  if (activeSession.order_id && activeSession.order_id !== orderId) {
    return;
  }

  // A retried/stale POS autosend can return an order from a previous table session.
  // Never let that old order get rebound to a newly opened bill: it makes the bill
  // appear duplicated and causes Table QR append requests to fail with ORDER_NOT_UPDATABLE.
  const { data: orderRow, error: orderLookupError } = await supabase
    .from("orders")
    .select("id,table_id,status,created_at")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", orderId)
    .eq("table_id", tableId)
    .maybeSingle<{ id: string; table_id: string | null; status: string; created_at: string }>();

  if (orderLookupError || !orderRow) {
    return;
  }

  const normalizedStatus = String(orderRow.status ?? "").trim().toLowerCase();
  if (TERMINAL_ORDER_STATUSES.has(normalizedStatus)) {
    return;
  }

  const sessionOpenedAt = Date.parse(activeSession.opened_at);
  const orderCreatedAt = Date.parse(orderRow.created_at);
  if (Number.isFinite(sessionOpenedAt) && Number.isFinite(orderCreatedAt) && orderCreatedAt < sessionOpenedAt) {
    return;
  }

  const { error: sessionUpdateError } = await supabase
    .from("table_bill_sessions")
    .update({
      status: "ordering",
      order_id: orderId,
      metadata: {
        ...(activeSession.metadata ?? {}),
        last_order_id: orderId,
        last_order_no: orderNo
      }
    })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", activeSession.id)
    .or('order_id.is.null,order_id.eq.' + orderId);
  if (sessionUpdateError) {
    return;
  }

  await supabase
    .from("dining_tables")
    .update({ status: "ordering" })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", tableId);
}

export async function cancelEmptyTableBillSession(args: {
  auth: AuthContext;
  tableId: string;
  appendAudit?: AuditFn;
  supabaseClient?: ReturnType<typeof getSupabaseServiceClient>;
}) {
  const { auth, tableId, appendAudit = appendAuditLog } = args;
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", message: "Missing tenant/branch scope.", status: 401 };
  }

  const supabase = args.supabaseClient ?? getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("cancel_empty_table_bill_session_tx", {
    p_tenant_id: auth.tenantId,
    p_branch_id: auth.branchId,
    p_table_id: tableId,
    p_actor_user_id: auth.userId
  });
  if (error) {
    const message = error.message || "Unable to cancel empty bill.";
    const code = message.includes("TABLE_BILL_NOT_EMPTY") ? "table_bill_not_empty"
      : message.includes("TABLE_BILL_NOT_OPEN") ? "table_bill_not_open"
        : "empty_bill_cancel_failed";
    return { ok: false as const, code, message, status: code === "empty_bill_cancel_failed" ? 500 : 409 };
  }

  const row = (Array.isArray(data) ? data[0] : data) as { table_session_id?: string; table_id?: string; cancelled?: boolean } | null;
  if (!row?.cancelled) {
    return { ok: false as const, code: "empty_bill_cancel_failed", message: "Unable to cancel empty bill.", status: 500 };
  }

  await appendAudit({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole ?? "tenant_user",
    action: "table_bill.empty_cancelled",
    targetTable: "table_bill_sessions",
    targetId: row.table_session_id,
    metadata: { table_id: tableId }
  });

  return { ok: true as const, data: row };
}
