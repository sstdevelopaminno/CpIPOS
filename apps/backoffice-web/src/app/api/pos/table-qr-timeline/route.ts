import { fail, ok } from "@/lib/http";
import { resolveQrKitchenHardeningFlags } from "@/lib/fg0003-qr-kitchen-hardening";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { PosGuardError } from "@/lib/pos-session-guard";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

type TimelineRow = {
  id: string;
  table_id: string;
  table_session_id: string;
  qr_session_id: string | null;
  client_session_id: string | null;
  client_id: string | null;
  event_type: string;
  severity: "green" | "yellow" | "red";
  request_id: string | null;
  submission_id: string | null;
  order_id: string | null;
  item_count: number | null;
  amount: number | null;
  success: boolean | null;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
  device_brand: string | null;
  device_model: string | null;
  device_class: string | null;
  os_name: string | null;
  os_version: string | null;
  browser_name: string | null;
  browser_version: string | null;
  device_summary: string | null;
  payload: Record<string, unknown> | null;
  event_at: string;
};

type ClientRow = {
  id: string;
  table_session_id: string;
  client_id: string;
  device_brand: string | null;
  device_model: string | null;
  device_class: string | null;
  os_name: string | null;
  os_version: string | null;
  browser_name: string | null;
  browser_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
  scan_count: number;
  submit_attempt_count: number;
  submit_success_count: number;
  submit_failure_count: number;
  duplicate_count: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function itemProductIds(payload: Record<string, unknown>) {
  const ids = new Set<string>();
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const raw of items) {
    const item = asRecord(raw);
    const id = String(item.product_id ?? "").trim();
    if (id) ids.add(id);
  }
  const direct = String(payload.product_id ?? "").trim();
  if (direct) ids.add(direct);
  return ids;
}

function enrichPayloadItems(payload: Record<string, unknown>, products: Map<string, { name: string; sku: string | null }>) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const enriched = items.map((raw) => {
    const item = asRecord(raw);
    const productId = String(item.product_id ?? "").trim();
    const product = products.get(productId);
    return {
      ...item,
      product_id: productId || null,
      product_name: product?.name ?? null,
      product_sku: product?.sku ?? null
    };
  });
  const directProductId = String(payload.product_id ?? "").trim();
  const directProduct = products.get(directProductId);
  return {
    ...payload,
    ...(enriched.length ? { items: enriched } : {}),
    ...(directProductId ? { product_id: directProductId, product_name: directProduct?.name ?? null, product_sku: directProduct?.sku ?? null } : {})
  };
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const role = String(auth.branchRole ?? "").trim().toLowerCase();
    if (role !== "owner" && role !== "manager") return fail("forbidden", "Owner or manager permission is required.", 403);

    const flags = resolveQrKitchenHardeningFlags({ tenantId: auth.tenantId, branchId: auth.branchId });
    if (!flags.qr_pos_review_required) return fail("table_qr_timeline_not_enabled", "QR order timeline is enabled only for this rollout branch.", 404);

    const url = new URL(request.url);
    const hoursRaw = Number(url.searchParams.get("hours") ?? 24);
    const hours = [12, 24, 48, 168].includes(hoursRaw) ? hoursRaw : 24;
    const tableId = String(url.searchParams.get("table_id") ?? "").trim();
    const severity = String(url.searchParams.get("severity") ?? "").trim();
    const limitRaw = Number(url.searchParams.get("limit") ?? 500);
    const limit = Math.max(50, Math.min(800, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 500));
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const supabase = getRoutedSupabaseServiceClient();

    let eventQuery = supabase
      .from("table_qr_timeline_events")
      .select("id,table_id,table_session_id,qr_session_id,client_session_id,client_id,event_type,severity,request_id,submission_id,order_id,item_count,amount,success,status_code,error_code,duration_ms,device_brand,device_model,device_class,os_name,os_version,browser_name,browser_version,device_summary,payload,event_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .gte("event_at", cutoff)
      .order("event_at", { ascending: false })
      .limit(limit);
    if (tableId) eventQuery = eventQuery.eq("table_id", tableId);
    if (severity === "green" || severity === "yellow" || severity === "red") eventQuery = eventQuery.eq("severity", severity);

    const [eventResult, clientResult] = await Promise.all([
      eventQuery,
      supabase
        .from("table_qr_client_sessions")
        .select("id,table_session_id,client_id,device_brand,device_model,device_class,os_name,os_version,browser_name,browser_version,first_seen_at,last_seen_at,scan_count,submit_attempt_count,submit_success_count,submit_failure_count,duplicate_count")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .gte("last_seen_at", cutoff)
        .order("last_seen_at", { ascending: false })
        .limit(500)
    ]);
    if (eventResult.error) throw new Error(eventResult.error.message);
    if (clientResult.error) throw new Error(clientResult.error.message);

    const rows = (eventResult.data ?? []) as TimelineRow[];
    const clients = (clientResult.data ?? []) as ClientRow[];
    const tableIds = Array.from(new Set(rows.map((row) => row.table_id).filter(Boolean)));
    const productIds = new Set<string>();
    for (const row of rows) for (const productId of itemProductIds(asRecord(row.payload))) productIds.add(productId);

    const [tableResult, productResult] = await Promise.all([
      tableIds.length
        ? supabase.from("dining_tables").select("id,table_code,table_name").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).in("id", tableIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.size
        ? supabase.from("products").select("id,sku,name").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).in("id", Array.from(productIds))
        : Promise.resolve({ data: [], error: null })
    ]);
    if (tableResult.error) throw new Error(tableResult.error.message);
    if (productResult.error) throw new Error(productResult.error.message);

    const tables = new Map((tableResult.data ?? []).map((row: { id: string; table_code: string; table_name: string | null }) => [row.id, row]));
    const products = new Map((productResult.data ?? []).map((row: { id: string; sku: string | null; name: string }) => [row.id, { name: row.name, sku: row.sku }]));

    const terminalByRequest = new Map<string, TimelineRow>();
    for (const row of rows) {
      if (!row.request_id) continue;
      if (["submit_success", "submit_failure", "duplicate_blocked"].includes(row.event_type) && !terminalByRequest.has(row.request_id)) {
        terminalByRequest.set(row.request_id, row);
      }
    }

    const attempts = rows.filter((row) => row.event_type === "submit_attempt");
    const concurrentById = new Map<string, number>();
    for (const attempt of attempts) {
      const at = Date.parse(attempt.event_at);
      const clientsNear = new Set<string>();
      if (attempt.client_id) clientsNear.add(attempt.client_id);
      for (const peer of attempts) {
        if (peer.id === attempt.id || peer.table_session_id !== attempt.table_session_id) continue;
        if (Math.abs(Date.parse(peer.event_at) - at) > 3_000) continue;
        if (peer.client_id) clientsNear.add(peer.client_id);
      }
      concurrentById.set(attempt.id, clientsNear.size);
    }

    const events = rows.map((row) => {
      const terminal = row.event_type === "submit_attempt" && row.request_id ? terminalByRequest.get(row.request_id) : null;
      const ageMs = Date.now() - Date.parse(row.event_at);
      const attemptState = row.event_type !== "submit_attempt"
        ? null
        : terminal?.event_type === "submit_success"
          ? "success"
          : terminal?.event_type === "duplicate_blocked"
            ? "duplicate_blocked"
            : terminal?.event_type === "submit_failure"
              ? "failed"
              : ageMs > 20_000 ? "unresolved" : "waiting";
      return {
        ...row,
        table: tables.get(row.table_id) ?? null,
        payload: enrichPayloadItems(asRecord(row.payload), products),
        attempt_state: attemptState,
        concurrent_clients: concurrentById.get(row.id) ?? 0
      };
    });

    const uniqueClients = new Set(clients.map((row) => row.client_id).filter((id) => id && id !== "anonymous"));
    const summary = {
      hours,
      unique_clients: uniqueClients.size,
      scans: clients.reduce((sum, row) => sum + Number(row.scan_count ?? 0), 0),
      submit_attempts: rows.filter((row) => row.event_type === "submit_attempt").length,
      submit_success: rows.filter((row) => row.event_type === "submit_success").length,
      submit_failure: rows.filter((row) => row.event_type === "submit_failure").length,
      duplicate_blocked: rows.filter((row) => row.event_type === "duplicate_blocked").length,
      cancellations: rows.filter((row) => row.event_type === "item_cancelled").length,
      concurrent_attempts: attempts.filter((row) => (concurrentById.get(row.id) ?? 0) > 1).length,
      red_events: rows.filter((row) => row.severity === "red").length,
      yellow_events: rows.filter((row) => row.severity === "yellow").length
    };

    return ok({ summary, events, clients, server_time: new Date().toISOString(), retention_days: 7 });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("table_qr_timeline_failed", error instanceof Error ? error.message : "Unable to load QR timeline.", 500);
  }
}
