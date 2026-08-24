import { fail, ok } from "@/lib/http";
import { resolveQrKitchenHardeningFlags } from "@/lib/fg0003-qr-kitchen-hardening";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { PosGuardError } from "@/lib/pos-session-guard";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

type ServiceEventType = "call_staff" | "request_checkout";
type ActivityEventType = "order" | ServiceEventType;
type AckAction = "acknowledge" | "go_to_table";

type ActivityRow = {
  id: string;
  table_id: string;
  event_type: ActivityEventType;
  item_count: number | null;
  subtotal: number | null;
  payload: Record<string, unknown> | null;
  review_status: string | null;
  created_at: string;
};

type ServiceEventRow = {
  id: string;
  event_type: ServiceEventType;
  payload: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isAcknowledged(payload: Record<string, unknown> | null) {
  return typeof payload?.acknowledged_at === "string" && payload.acknowledged_at.trim().length > 0;
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const flags = resolveQrKitchenHardeningFlags({ tenantId: auth.tenantId, branchId: auth.branchId });
    const fg0003PendingOnly = flags.qr_pos_review_required;
    const { searchParams } = new URL(request.url);
    const sinceRaw = searchParams.get("since")?.trim() || new Date(Date.now() - 15_000).toISOString();
    const since = Number.isFinite(new Date(sinceRaw).getTime()) ? new Date(sinceRaw).toISOString() : new Date(Date.now() - 15_000).toISOString();
    const supabase = getRoutedSupabaseServiceClient();

    let rawRows: ActivityRow[] = [];
    let cursor = since;

    if (fg0003PendingOnly) {
      // FG0003 order alerts are an acknowledgement queue. Never let the polling cursor
      // hide an older unreviewed order, and expose only the oldest pending order globally.
      // Service requests still use the normal cursor and are returned before the pending
      // order so a latest-wins client cannot replace the order review with a newer event.
      const [pendingOrderResult, serviceResult] = await Promise.all([
        supabase
          .from("table_qr_orders")
          .select("id,table_id,event_type,item_count,subtotal,payload,review_status,created_at")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("event_type", "order")
          .eq("review_status", "pending_pos_review")
          .order("created_at", { ascending: true })
          .limit(1),
        supabase
          .from("table_qr_orders")
          .select("id,table_id,event_type,item_count,subtotal,payload,review_status,created_at")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("event_type", ["call_staff", "request_checkout"])
          .gt("created_at", since)
          .order("created_at", { ascending: true })
          .limit(25)
      ]);
      if (pendingOrderResult.error) throw new Error(pendingOrderResult.error.message);
      if (serviceResult.error) throw new Error(serviceResult.error.message);

      const serviceRows = ((serviceResult.data ?? []) as ActivityRow[]).filter((row) => !isAcknowledged(row.payload));
      const pendingRows = (pendingOrderResult.data ?? []) as ActivityRow[];
      rawRows = [...serviceRows, ...pendingRows];
      cursor = ((serviceResult.data ?? []) as ActivityRow[]).at(-1)?.created_at ?? since;
    } else {
      const { data: rows, error } = await supabase
        .from("table_qr_orders")
        .select("id,table_id,event_type,item_count,subtotal,payload,review_status,created_at")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .in("event_type", ["order", "call_staff", "request_checkout"])
        .gt("created_at", since)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);
      rawRows = (rows ?? []) as ActivityRow[];
      cursor = rawRows.at(-1)?.created_at ?? since;
    }

    const visibleRows = rawRows.filter((row) => {
      if (row.event_type === "order") {
        return !fg0003PendingOnly || row.review_status === "pending_pos_review";
      }
      return !isAcknowledged(row.payload);
    });
    const tableIds = Array.from(new Set(visibleRows.map((row) => String(row.table_id ?? "")).filter(Boolean)));
    const tableResult = tableIds.length
      ? await supabase
          .from("dining_tables")
          .select("id,table_code,table_name")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("id", tableIds)
      : { data: [], error: null };
    if (tableResult.error) throw new Error(tableResult.error.message);

    const tableById = new Map((tableResult.data ?? []).map((table: { id: string; table_code: string; table_name: string | null }) => [table.id, table]));
    const events = visibleRows.map((row) => ({
      id: row.id,
      table_id: row.table_id,
      event_type: row.event_type,
      item_count: row.item_count,
      subtotal: row.subtotal,
      created_at: row.created_at,
      table: tableById.get(row.table_id) ?? null
    }));

    return ok({
      events,
      cursor,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("table_qr_activity_failed", error instanceof Error ? error.message : "Unable to load table QR activity.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const body = asRecord(await request.json().catch(() => null));
    const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
    const action: AckAction = body.action === "go_to_table" ? "go_to_table" : "acknowledge";
    if (!eventId) return fail("table_qr_activity_event_required", "event_id is required.", 422);

    const supabase = getRoutedSupabaseServiceClient();
    const { data: eventData, error: readError } = await supabase
      .from("table_qr_orders")
      .select("id,event_type,payload")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", eventId)
      .in("event_type", ["call_staff", "request_checkout"])
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const eventRow = (eventData ?? null) as ServiceEventRow | null;
    if (!eventRow) return fail("table_qr_activity_event_not_found", "Table QR service event was not found.", 404);

    const currentPayload = asRecord(eventRow.payload);
    if (isAcknowledged(currentPayload)) {
      return ok({ id: eventRow.id, acknowledged: true, duplicate: true });
    }

    const acknowledgedAt = new Date().toISOString();
    const nextPayload = {
      ...currentPayload,
      acknowledged_at: acknowledgedAt,
      acknowledged_by: auth.userId,
      acknowledged_action: action
    };
    const { error: updateError } = await supabase
      .from("table_qr_orders")
      .update({ payload: nextPayload })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", eventRow.id);
    if (updateError) throw new Error(updateError.message);

    return ok({ id: eventRow.id, acknowledged: true, duplicate: false, acknowledged_at: acknowledgedAt });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("table_qr_activity_ack_failed", error instanceof Error ? error.message : "Unable to acknowledge table QR activity.", 500);
  }
}
