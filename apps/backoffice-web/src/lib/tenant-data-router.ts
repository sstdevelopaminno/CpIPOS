import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { readRequiredEnv } from "@/lib/env";

type ServiceClient = ReturnType<typeof createClient>;
type DataHome = "primary" | "trial" | "archive";
type QueryCall = { method: string; args: unknown[] };
type RouteHint = { tenantId: string | null; branchId: string | null };
type ObjectRoute = { tenant_id: string; branch_id: string | null };
type LifecycleRow = { data_home: DataHome; lifecycle_status: string; routing_version: number | null };
type PosSessionRouteRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  device_code: string | null;
  shift_id: string | null;
  status: string;
  issued_at: string;
  expires_at: string;
};
type ShiftRouteRow = { id: string; status: string };

type CacheEntry<T> = { value: T; expiresAt: number };

const BUSINESS_TABLES = new Set([
  "branch_inventory_settings",
  "tenant_tax_settings",
  "product_categories",
  "products",
  "product_combo_items",
  "ingredients",
  "ingredient_packages",
  "recipes",
  "stock_movements",
  "table_zones",
  "dining_tables",
  "table_layout_objects",
  "table_bill_sessions",
  "table_qr_sessions",
  "table_qr_orders",
  "orders",
  "order_items",
  "payments",
  "transfer_payment_verifications"
]);

const BUSINESS_RPCS = new Set([
  "next_pos_order_no",
  "create_pos_order_tx",
  "complete_pos_payment_tx",
  "submit_table_qr_order_tx",
  "create_stock_adjustment_tx"
]);

const MUTATION_METHODS = new Set(["insert", "upsert", "update", "delete"]);
const ROUTE_CACHE_TTL_MS = 1_500;
const SCOPE_SYNC_TTL_MS = 15_000;
const RUNTIME_LEASE_TTL_MS = 120_000;

export class TenantDataRoutingError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TenantDataRoutingError";
    this.code = code;
  }
}

function createPrimaryClient() {
  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "Missing Supabase service role environment variables.");
  const key = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY", "Missing Supabase service role environment variables.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function createTrialClient() {
  const url = String(process.env.TRIAL_SUPABASE_URL ?? "").trim();
  const key = String(process.env.TRIAL_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) {
    throw new TenantDataRoutingError(
      "trial_data_plane_credentials_missing",
      "CpiPOS-002 routing is required for this tenant, but the server-only Trial Supabase credentials are missing."
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function getGlobalCache() {
  return globalThis as typeof globalThis & {
    __cpiposPrimaryServiceClient?: ServiceClient;
    __cpiposTrialServiceClient?: ServiceClient;
    __cpiposRoutedServiceClient?: ServiceClient;
    __cpiposTenantDataRouteCache?: Map<string, CacheEntry<LifecycleRow | null>>;
    __cpiposTrialScopeSyncCache?: Map<string, number>;
  };
}

export function getPrimarySupabaseServiceClient(): ServiceClient {
  if (typeof window !== "undefined") {
    throw new Error("Supabase service client can only be used on the server.");
  }
  const cache = getGlobalCache();
  if (!cache.__cpiposPrimaryServiceClient) cache.__cpiposPrimaryServiceClient = createPrimaryClient();
  return cache.__cpiposPrimaryServiceClient;
}

export function getTrialSupabaseServiceClient(): ServiceClient {
  if (typeof window !== "undefined") {
    throw new Error("Supabase service client can only be used on the server.");
  }
  const cache = getGlobalCache();
  if (!cache.__cpiposTrialServiceClient) cache.__cpiposTrialServiceClient = createTrialClient();
  return cache.__cpiposTrialServiceClient;
}

function trialRoutingEnabled() {
  const value = String(process.env.TRIAL_DATA_ROUTING_ENABLED ?? "false").trim().toLowerCase();
  return value === "1" || value === "true";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function firstPayloadRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return recordValue(value[0]);
  return recordValue(value);
}

function inferScopeFromCalls(calls: QueryCall[]): RouteHint {
  let tenantId: string | null = null;
  let branchId: string | null = null;

  for (const call of calls) {
    if (call.method === "eq") {
      const field = stringValue(call.args[0]);
      const value = stringValue(call.args[1]);
      if (field === "tenant_id" && value) tenantId = value;
      if (field === "branch_id" && value) branchId = value;
    }
    if (call.method === "match") {
      const payload = recordValue(call.args[0]);
      tenantId = stringValue(payload?.tenant_id) ?? tenantId;
      branchId = stringValue(payload?.branch_id) ?? branchId;
    }
    if (call.method === "in") {
      const field = stringValue(call.args[0]);
      const values = Array.isArray(call.args[1]) ? call.args[1] : [];
      if (values.length === 1) {
        const value = stringValue(values[0]);
        if (field === "tenant_id" && value) tenantId = value;
        if (field === "branch_id" && value) branchId = value;
      }
    }
    if (call.method === "insert" || call.method === "upsert" || call.method === "update") {
      const payload = firstPayloadRecord(call.args[0]);
      tenantId = stringValue(payload?.tenant_id) ?? tenantId;
      branchId = stringValue(payload?.branch_id) ?? branchId;
    }
  }

  return { tenantId, branchId };
}

function inferScopeFromRpc(params: Record<string, unknown>): RouteHint {
  return {
    tenantId: stringValue(params.p_tenant_id) ?? stringValue(params.tenant_id),
    branchId: stringValue(params.p_branch_id) ?? stringValue(params.branch_id)
  };
}

function eqFilter(calls: QueryCall[], field: string): string | null {
  for (const call of calls) {
    if (call.method !== "eq") continue;
    if (stringValue(call.args[0]) !== field) continue;
    const value = stringValue(call.args[1]);
    if (value) return value;
  }
  return null;
}

function objectRouteHint(table: string, calls: QueryCall[]): { objectType: string; objectId: string } | null {
  const id = eqFilter(calls, "id");
  if (id) return { objectType: table, objectId: id };

  const foreignRouteFields: Array<[string, string]> = [
    ["order_id", "orders"],
    ["qr_session_id", "table_qr_sessions"],
    ["table_session_id", "table_bill_sessions"],
    ["table_id", "dining_tables"],
    ["product_id", "products"],
    ["ingredient_id", "ingredients"]
  ];
  for (const [field, objectType] of foreignRouteFields) {
    const objectId = eqFilter(calls, field);
    if (objectId) return { objectType, objectId };
  }
  return null;
}

async function lookupObjectRoute(objectType: string, objectId: string): Promise<ObjectRoute | null> {
  const primary = getPrimarySupabaseServiceClient();
  const { data, error } = await primary
    .from("tenant_data_object_routes")
    .select("tenant_id,branch_id")
    .eq("object_type", objectType)
    .eq("object_id", objectId)
    .maybeSingle<ObjectRoute>();
  if (error) throw new TenantDataRoutingError("object_route_lookup_failed", error.message);
  return data ?? null;
}

async function currentPosSessionRouteHint(): Promise<PosSessionRouteRow | null> {
  try {
    const store = await cookies();
    const cookieName = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";
    const sessionId = String(store.get(cookieName)?.value ?? "").trim().replace(/^\"+|\"+$/g, "");
    if (!sessionId) return null;
    const primary = getPrimarySupabaseServiceClient();
    const { data, error } = await primary
      .from("pos_sessions")
      .select("id,tenant_id,branch_id,user_id,device_code,shift_id,status,issued_at,expires_at")
      .eq("id", sessionId)
      .maybeSingle<PosSessionRouteRow>();
    if (error || !data) return null;
    if (data.status !== "active" || new Date(data.expires_at).getTime() <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function lifecycleCache() {
  const globalCache = getGlobalCache();
  if (!globalCache.__cpiposTenantDataRouteCache) globalCache.__cpiposTenantDataRouteCache = new Map();
  return globalCache.__cpiposTenantDataRouteCache;
}

async function loadLifecycle(tenantId: string): Promise<LifecycleRow | null> {
  const cache = lifecycleCache();
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const primary = getPrimarySupabaseServiceClient();
  const { data, error } = await primary
    .from("tenant_data_lifecycle")
    .select("data_home,lifecycle_status,routing_version")
    .eq("tenant_id", tenantId)
    .maybeSingle<LifecycleRow>();
  if (error) throw new TenantDataRoutingError("tenant_data_lifecycle_lookup_failed", error.message);
  const value = data ?? null;
  cache.set(tenantId, { value, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });
  return value;
}

function mapTrialLifecycleStatus(status: string): "trial" | "active" | "grace" | "expired" | "archived" {
  if (status === "trial") return "trial";
  if (status === "grace") return "grace";
  if (status === "expired" || status === "suspended") return "expired";
  if (status === "archived") return "archived";
  return "active";
}

function scopeSyncCache() {
  const globalCache = getGlobalCache();
  if (!globalCache.__cpiposTrialScopeSyncCache) globalCache.__cpiposTrialScopeSyncCache = new Map();
  return globalCache.__cpiposTrialScopeSyncCache;
}

async function ensureTrialScopes(tenantId: string, branchId: string | null) {
  const key = `${tenantId}:${branchId ?? "tenant"}`;
  const cache = scopeSyncCache();
  const expiresAt = cache.get(key) ?? 0;
  if (expiresAt > Date.now()) return;

  const primary = getPrimarySupabaseServiceClient();
  const trial = getTrialSupabaseServiceClient();
  const [lifecycleResult, tenantResult, branchResult] = await Promise.all([
    primary.from("tenant_data_lifecycle").select("lifecycle_status,routing_version").eq("tenant_id", tenantId).maybeSingle<{ lifecycle_status: string; routing_version: number | null }>(),
    primary.from("tenants").select("id,code,name,is_active").eq("id", tenantId).maybeSingle<{ id: string; code: string; name: string | null; is_active: boolean }>(),
    branchId
      ? primary.from("branches").select("id,code,name,is_active").eq("tenant_id", tenantId).eq("id", branchId).maybeSingle<{ id: string; code: string | null; name: string | null; is_active: boolean }>()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (lifecycleResult.error) throw new TenantDataRoutingError("trial_scope_lifecycle_lookup_failed", lifecycleResult.error.message);
  if (tenantResult.error) throw new TenantDataRoutingError("trial_scope_tenant_lookup_failed", tenantResult.error.message);
  if (!tenantResult.data) throw new TenantDataRoutingError("trial_scope_tenant_missing", "Tenant was not found in CpiPOS-001.");
  if (branchResult.error) throw new TenantDataRoutingError("trial_scope_branch_lookup_failed", branchResult.error.message);
  if (branchId && !branchResult.data) throw new TenantDataRoutingError("trial_scope_branch_missing", "Branch was not found in CpiPOS-001.");

  const lifecycleStatus = mapTrialLifecycleStatus(lifecycleResult.data?.lifecycle_status ?? "active");
  const tenantUpsert = await trial.from("trial_tenant_scopes").upsert(
    {
      tenant_id: tenantId,
      lifecycle_status: lifecycleStatus,
      is_active: tenantResult.data.is_active !== false && lifecycleStatus !== "expired" && lifecycleStatus !== "archived",
      source_control_plane: "CpiPOS-001",
      synced_at: new Date().toISOString(),
      metadata: {
        tenant_code: tenantResult.data.code,
        tenant_name: tenantResult.data.name,
        routing_version: lifecycleResult.data?.routing_version ?? null
      }
    },
    { onConflict: "tenant_id" }
  );
  if (tenantUpsert.error) throw new TenantDataRoutingError("trial_scope_tenant_sync_failed", tenantUpsert.error.message);

  if (branchId && branchResult.data) {
    const branchUpsert = await trial.from("trial_branch_scopes").upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        is_active: branchResult.data.is_active !== false,
        synced_at: new Date().toISOString(),
        metadata: {
          branch_code: branchResult.data.code,
          branch_name: branchResult.data.name
        }
      },
      { onConflict: "tenant_id,branch_id" }
    );
    if (branchUpsert.error) throw new TenantDataRoutingError("trial_scope_branch_sync_failed", branchUpsert.error.message);
  }

  cache.set(key, Date.now() + SCOPE_SYNC_TTL_MS);
}

async function findOpenShift(tenantId: string, branchId: string, preferredShiftId: string | null): Promise<string> {
  const primary = getPrimarySupabaseServiceClient();
  if (preferredShiftId) {
    const { data, error } = await primary
      .from("shifts")
      .select("id,status")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("id", preferredShiftId)
      .eq("status", "open")
      .maybeSingle<ShiftRouteRow>();
    if (error) throw new TenantDataRoutingError("trial_runtime_shift_lookup_failed", error.message);
    if (!data) throw new TenantDataRoutingError("trial_runtime_shift_not_open", "The CpiPOS-001 shift is not open.");
    return data.id;
  }

  const { data, error } = await primary
    .from("shifts")
    .select("id,status")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<ShiftRouteRow>();
  if (error) throw new TenantDataRoutingError("trial_runtime_shift_lookup_failed", error.message);
  if (!data) throw new TenantDataRoutingError("trial_runtime_shift_not_open", "An open CpiPOS-001 shift is required for Trial transactions.");
  return data.id;
}

async function findActivePosSession(args: {
  tenantId: string;
  branchId: string;
  userId: string | null;
  preferredShiftId: string | null;
}): Promise<PosSessionRouteRow> {
  const { tenantId, branchId, userId, preferredShiftId } = args;
  const current = await currentPosSessionRouteHint();
  if (
    current &&
    current.tenant_id === tenantId &&
    current.branch_id === branchId &&
    (!userId || current.user_id === userId)
  ) {
    return current;
  }

  const primary = getPrimarySupabaseServiceClient();
  let query = primary
    .from("pos_sessions")
    .select("id,tenant_id,branch_id,user_id,device_code,shift_id,status,issued_at,expires_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if (userId) query = query.eq("user_id", userId);
  if (preferredShiftId) query = query.or(`shift_id.eq.${preferredShiftId},shift_id.is.null`);
  const { data, error } = await query.order("issued_at", { ascending: false }).limit(1).maybeSingle<PosSessionRouteRow>();
  if (error) throw new TenantDataRoutingError("trial_runtime_session_lookup_failed", error.message);
  if (!data) throw new TenantDataRoutingError("trial_runtime_session_missing", "An active CpiPOS-001 POS session is required for Trial transactions.");
  return data;
}

async function ensureTrialRuntimeLease(args: {
  tenantId: string;
  branchId: string;
  userId?: string | null;
  shiftId?: string | null;
}) {
  const shiftId = await findOpenShift(args.tenantId, args.branchId, args.shiftId ?? null);
  const session = await findActivePosSession({
    tenantId: args.tenantId,
    branchId: args.branchId,
    userId: args.userId ?? null,
    preferredShiftId: shiftId
  });
  if (args.userId && session.user_id !== args.userId) {
    throw new TenantDataRoutingError("trial_runtime_user_mismatch", "CpiPOS-001 POS session user does not match the requested actor.");
  }

  const sessionExpiryMs = new Date(session.expires_at).getTime();
  const leaseExpiryMs = Math.min(sessionExpiryMs, Date.now() + RUNTIME_LEASE_TTL_MS);
  if (!Number.isFinite(leaseExpiryMs) || leaseExpiryMs <= Date.now()) {
    throw new TenantDataRoutingError("trial_runtime_session_expired", "CpiPOS-001 POS session is expired.");
  }

  const trial = getTrialSupabaseServiceClient();
  const { error } = await trial.from("trial_runtime_leases").upsert(
    {
      pos_session_id: session.id,
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      shift_id: shiftId,
      user_id: session.user_id,
      device_code: session.device_code,
      status: "active",
      issued_at: session.issued_at,
      expires_at: new Date(leaseExpiryMs).toISOString(),
      synced_at: new Date().toISOString(),
      metadata: { source: "CpiPOS-001", router: "server" }
    },
    { onConflict: "pos_session_id" }
  );
  if (error) throw new TenantDataRoutingError("trial_runtime_lease_sync_failed", error.message);
}

async function resolveClientForTenant(tenantId: string, branchId: string | null) {
  const lifecycle = await loadLifecycle(tenantId);
  const home = lifecycle?.data_home ?? "primary";
  if (home === "primary") return { client: getPrimarySupabaseServiceClient(), home };
  if (home === "archive") {
    throw new TenantDataRoutingError("tenant_data_archived", "This tenant business-data set is archived and cannot accept live POS traffic.");
  }
  if (!trialRoutingEnabled()) {
    throw new TenantDataRoutingError(
      "trial_data_routing_disabled",
      "CpiPOS-001 marks this tenant as Trial Data Plane, but TRIAL_DATA_ROUTING_ENABLED is not enabled. Routing failed closed."
    );
  }
  await ensureTrialScopes(tenantId, branchId);
  return { client: getTrialSupabaseServiceClient(), home };
}

function isMutation(calls: QueryCall[]) {
  return calls.some((call) => MUTATION_METHODS.has(call.method));
}

async function resolveTableTarget(table: string, calls: QueryCall[]) {
  const scope = inferScopeFromCalls(calls);
  if (scope.tenantId) {
    return { ...(await resolveClientForTenant(scope.tenantId, scope.branchId)), tenantId: scope.tenantId, branchId: scope.branchId };
  }

  const objectHint = objectRouteHint(table, calls);
  if (objectHint) {
    const objectRoute = await lookupObjectRoute(objectHint.objectType, objectHint.objectId);
    if (objectRoute) {
      return {
        ...(await resolveClientForTenant(objectRoute.tenant_id, objectRoute.branch_id)),
        tenantId: objectRoute.tenant_id,
        branchId: objectRoute.branch_id
      };
    }
  }

  const session = await currentPosSessionRouteHint();
  if (session) {
    return {
      ...(await resolveClientForTenant(session.tenant_id, session.branch_id)),
      tenantId: session.tenant_id,
      branchId: session.branch_id
    };
  }

  if (isMutation(calls)) {
    throw new TenantDataRoutingError(
      "tenant_data_route_unresolved",
      `Refusing an unscoped business-data mutation for ${table}; tenant routing could not be resolved.`
    );
  }

  return { client: getPrimarySupabaseServiceClient(), home: "primary" as const, tenantId: null, branchId: null };
}

async function resolveRpcTarget(fn: string, params: Record<string, unknown>) {
  let scope = inferScopeFromRpc(params);
  if (!scope.tenantId && fn === "submit_table_qr_order_tx") {
    const qrSessionId = stringValue(params.p_qr_session_id);
    if (qrSessionId) {
      const objectRoute = await lookupObjectRoute("table_qr_sessions", qrSessionId);
      if (objectRoute) scope = { tenantId: objectRoute.tenant_id, branchId: objectRoute.branch_id };
    }
  }
  if (!scope.tenantId) {
    const session = await currentPosSessionRouteHint();
    if (session) scope = { tenantId: session.tenant_id, branchId: session.branch_id };
  }
  if (!scope.tenantId) {
    throw new TenantDataRoutingError("tenant_data_route_unresolved", `Tenant routing could not be resolved for RPC ${fn}.`);
  }

  const target = await resolveClientForTenant(scope.tenantId, scope.branchId);
  if (target.home === "trial") {
    if (!scope.branchId && fn !== "next_pos_order_no") {
      throw new TenantDataRoutingError("trial_branch_route_unresolved", `Branch routing could not be resolved for Trial RPC ${fn}.`);
    }
    if (fn === "create_pos_order_tx") {
      await ensureTrialRuntimeLease({
        tenantId: scope.tenantId,
        branchId: scope.branchId!,
        userId: stringValue(params.p_created_by),
        shiftId: stringValue(params.p_shift_id)
      });
    } else if (fn === "complete_pos_payment_tx") {
      const orderId = stringValue(params.p_order_id);
      if (!orderId) throw new TenantDataRoutingError("trial_payment_order_missing", "Payment RPC is missing order ID.");
      const trial = getTrialSupabaseServiceClient();
      const { data: order, error } = await trial
        .from("orders")
        .select("shift_id")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId!)
        .eq("id", orderId)
        .maybeSingle<{ shift_id: string }>();
      if (error) throw new TenantDataRoutingError("trial_payment_order_lookup_failed", error.message);
      if (!order) throw new TenantDataRoutingError("trial_payment_order_missing", "Payment order was not found in CpiPOS-002.");
      await ensureTrialRuntimeLease({
        tenantId: scope.tenantId,
        branchId: scope.branchId!,
        userId: stringValue(params.p_received_by),
        shiftId: order.shift_id
      });
    } else if (fn === "submit_table_qr_order_tx") {
      await ensureTrialRuntimeLease({ tenantId: scope.tenantId, branchId: scope.branchId! });
    }
  }

  return { ...target, tenantId: scope.tenantId, branchId: scope.branchId };
}

function callable(target: unknown, method: string) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    throw new Error(`Supabase routed builder is not callable at ${method}.`);
  }
  const candidate = (target as Record<string, unknown>)[method];
  if (typeof candidate !== "function") throw new Error(`Supabase routed builder method is unavailable: ${method}.`);
  return candidate as (...args: unknown[]) => unknown;
}

async function replayBuilder(base: unknown, calls: QueryCall[]) {
  let current = base;
  for (const call of calls) {
    current = callable(current, call.method).apply(current, call.args);
  }
  return await Promise.resolve(current);
}

async function registerObjectRoutes(table: string, data: unknown, fallbackTenantId: string | null, fallbackBranchId: string | null) {
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  const entries: Array<Record<string, unknown>> = [];
  for (const rowValue of rows) {
    const row = recordValue(rowValue);
    const objectId = stringValue(row?.id);
    const tenantId = stringValue(row?.tenant_id) ?? fallbackTenantId;
    const branchId = stringValue(row?.branch_id) ?? fallbackBranchId;
    if (!objectId || !tenantId) continue;
    entries.push({
      object_type: table,
      object_id: objectId,
      tenant_id: tenantId,
      branch_id: branchId,
      updated_at: new Date().toISOString(),
      metadata: { source_home: "trial" }
    });
  }
  if (!entries.length) return;
  const primary = getPrimarySupabaseServiceClient();
  const { error } = await primary.from("tenant_data_object_routes").upsert(entries, { onConflict: "object_type,object_id" });
  if (error) console.error("[tenant-data-router] object route registration failed", { table, error: error.message });
}

async function registerRpcRoutes(fn: string, resultData: unknown, tenantId: string, branchId: string | null) {
  const rows = Array.isArray(resultData) ? resultData : resultData && typeof resultData === "object" ? [resultData] : [];
  const entries: Array<Record<string, unknown>> = [];
  for (const rowValue of rows) {
    const row = recordValue(rowValue);
    if (!row) continue;
    if (fn === "create_pos_order_tx") {
      const orderId = stringValue(row.order_id);
      if (orderId) entries.push({ object_type: "orders", object_id: orderId, tenant_id: tenantId, branch_id: branchId, metadata: { source_home: "trial" } });
    }
    if (fn === "submit_table_qr_order_tx") {
      const orderId = stringValue(row.order_id);
      const submissionId = stringValue(row.submission_id);
      if (orderId) entries.push({ object_type: "orders", object_id: orderId, tenant_id: tenantId, branch_id: branchId, metadata: { source_home: "trial" } });
      if (submissionId) entries.push({ object_type: "table_qr_orders", object_id: submissionId, tenant_id: tenantId, branch_id: branchId, metadata: { source_home: "trial" } });
    }
    if (fn === "create_stock_adjustment_tx") {
      const movementId = stringValue(row.movement_id);
      if (movementId) entries.push({ object_type: "stock_movements", object_id: movementId, tenant_id: tenantId, branch_id: branchId, metadata: { source_home: "trial" } });
    }
  }
  if (!entries.length) return;
  const primary = getPrimarySupabaseServiceClient();
  const { error } = await primary.from("tenant_data_object_routes").upsert(entries, { onConflict: "object_type,object_id" });
  if (error) console.error("[tenant-data-router] RPC object route registration failed", { fn, error: error.message });
}

function resultData(result: unknown): unknown {
  return recordValue(result)?.data;
}

function createDeferredTableBuilder(table: string) {
  const calls: QueryCall[] = [];
  let proxy: object;
  let execution: Promise<unknown> | null = null;

  const execute = () => {
    if (!execution) {
      execution = (async () => {
        const target = await resolveTableTarget(table, calls);
        const result = await replayBuilder(target.client.from(table), calls);
        if (target.home === "trial") {
          await registerObjectRoutes(table, resultData(result), target.tenantId, target.branchId);
        }
        return result;
      })();
    }
    return execution;
  };

  proxy = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return execute().then.bind(execute());
        if (property === "catch") return execute().catch.bind(execute());
        if (property === "finally") return execute().finally.bind(execute());
        if (property === Symbol.toStringTag) return "PostgrestBuilder";
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return proxy;
        };
      }
    }
  );
  return proxy;
}

function createDeferredRpcBuilder(fn: string, params: Record<string, unknown>, options: unknown) {
  const calls: QueryCall[] = [];
  let proxy: object;
  let execution: Promise<unknown> | null = null;

  const execute = () => {
    if (!execution) {
      execution = (async () => {
        const target = await resolveRpcTarget(fn, params);
        const rpcBase = options === undefined
          ? target.client.rpc(fn, params as never)
          : target.client.rpc(fn, params as never, options as never);
        const result = await replayBuilder(rpcBase, calls);
        if (target.home === "trial") {
          await registerRpcRoutes(fn, resultData(result), target.tenantId, target.branchId);
        }
        return result;
      })();
    }
    return execution;
  };

  proxy = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return execute().then.bind(execute());
        if (property === "catch") return execute().catch.bind(execute());
        if (property === "finally") return execute().finally.bind(execute());
        if (property === Symbol.toStringTag) return "PostgrestBuilder";
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return proxy;
        };
      }
    }
  );
  return proxy;
}

function createRoutedClient(): ServiceClient {
  const primary = getPrimarySupabaseServiceClient();
  return new Proxy(primary, {
    get(target, property, receiver) {
      if (property === "from") {
        return (table: string) => {
          if (!BUSINESS_TABLES.has(table)) return target.from(table);
          return createDeferredTableBuilder(table);
        };
      }
      if (property === "rpc") {
        return (fn: string, params: Record<string, unknown> = {}, options?: unknown) => {
          if (!BUSINESS_RPCS.has(fn)) return target.rpc(fn, params as never, options as never);
          return createDeferredRpcBuilder(fn, params, options);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as ServiceClient;
}

export function getRoutedSupabaseServiceClient(): ServiceClient {
  if (typeof window !== "undefined") {
    throw new Error("Supabase service client can only be used on the server.");
  }
  const cache = getGlobalCache();
  if (!cache.__cpiposRoutedServiceClient) cache.__cpiposRoutedServiceClient = createRoutedClient();
  return cache.__cpiposRoutedServiceClient;
}

export function invalidateTenantDataRouteCache(tenantId?: string) {
  const cache = lifecycleCache();
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
