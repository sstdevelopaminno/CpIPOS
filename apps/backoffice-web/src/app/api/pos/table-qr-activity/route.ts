import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

type ServiceEventType = "call_staff" | "request_checkout";
type AckAction = "acknowledge" | "go_to_table";

type ActivityRow = {
  id: string;
  table_id: string;
  event_type: ServiceEventType;
  item_count: number | null;
  subtotal: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
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
    const { searchParams } = new URL(request.url);
    const sinceRaw = searchParams.get("since")?.trim() || new Date(Date.now() - 15_000).toISOString();
    const since = Number.isFinite(new Date(sinceRaw).getTime()) ? new Date(sinceRaw).toISOString() : new Date(Date.now() - 15_000).toISOString();
    const supabase = getRoutedSupabaseServiceClient();

    const { data: rows, error } = await supabase
      .from("table_qr_orders")
      .select("id,table_id,event_type,item_count,subtotal,payload,created_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("event_type", ["call_staff", "request_checkout"])
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    const rawRows = (rows ?? []) as ActivityRow[];
    const visibleRows = rawRows.filter((row) => !isAcknowledged(row.payload));
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
      cursor: rawRows.at(-1)?.created_at ?? since,
      server_time: new Date().toISOString()
    });
  } catch (error) {
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
    const { data: eventRow, error: readError } = await supabase
      .from("table_qr_orders")
      .select("id,event_type,payload")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", eventId)
      .in("event_type", ["call_staff", "request_checkout"])
      .maybeSingle<{ id: string; event_type: ServiceEventType; payload: Record<string, unknown> | null }>();
    if (readError) throw new Error(readError.message);
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
    return fail("table_qr_activity_ack_failed", error instanceof Error ? error.message : "Unable to acknowledge table QR activity.", 500);
  }
}
