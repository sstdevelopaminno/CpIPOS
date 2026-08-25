import "server-only";
import { getServiceClient } from "@/lib/supabase";

export type StoreRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  package_name: string | null;
  store_code: string;
  access_code: string | null;
  branch_count: number;
  active_branch_count: number;
  device_count: number;
  live_device_count: number;
  active_session_count: number;
  open_shift_count: number;
};

async function safeCount(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const result = await query;
  return result.error ? null : (result.count ?? 0);
}

export async function loadOperationsSnapshot() {
  const supabase = getServiceClient();
  const now = Date.now();
  const liveSince = new Date(now - 5 * 60_000).toISOString();
  const qrSince = new Date(now - 15 * 60_000).toISOString();

  const { data: tenants, error: tenantError } = await supabase
    .from("tenants")
    .select("id,code,name,is_active,package_id")
    .order("created_at", { ascending: true });
  if (tenantError) throw new Error(tenantError.message);

  const tenantIds = (tenants ?? []).map((row) => String(row.id));
  const packageIds = (tenants ?? []).map((row) => row.package_id).filter(Boolean) as string[];

  const [{ data: accessCodes }, { data: packages }, { data: branches }, { data: devices }, { data: sessions }, { data: shifts }] = await Promise.all([
    tenantIds.length
      ? supabase.from("tenant_access_codes").select("tenant_id,access_code,is_active").in("tenant_id", tenantIds)
      : Promise.resolve({ data: [] as Array<{ tenant_id: string; access_code: string; is_active: boolean }> }),
    packageIds.length
      ? supabase.from("subscription_packages").select("id,name").in("id", packageIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    tenantIds.length
      ? supabase.from("branches").select("id,tenant_id,is_active").in("tenant_id", tenantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; tenant_id: string; is_active: boolean }> }),
    tenantIds.length
      ? supabase.from("branch_devices").select("id,tenant_id,status,last_seen_at").in("tenant_id", tenantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; tenant_id: string; status: string; last_seen_at: string | null }> }),
    tenantIds.length
      ? supabase.from("pos_sessions").select("id,tenant_id,status,expires_at").in("tenant_id", tenantIds).eq("status", "active")
      : Promise.resolve({ data: [] as Array<{ id: string; tenant_id: string; status: string; expires_at: string }> }),
    tenantIds.length
      ? supabase.from("shifts").select("id,tenant_id,status").in("tenant_id", tenantIds).eq("status", "open")
      : Promise.resolve({ data: [] as Array<{ id: string; tenant_id: string; status: string }> })
  ]);

  const accessCodeByTenant = new Map((accessCodes ?? []).filter((r) => r.is_active).map((r) => [String(r.tenant_id), String(r.access_code)]));
  const packageById = new Map((packages ?? []).map((r) => [String(r.id), String(r.name)]));
  const count = <T extends { tenant_id: string }>(rows: T[] | null | undefined, tenantId: string, predicate: (row: T) => boolean = () => true) =>
    (rows ?? []).filter((row) => String(row.tenant_id) === tenantId && predicate(row)).length;

  const stores: StoreRow[] = (tenants ?? []).map((tenant) => {
    const tenantId = String(tenant.id);
    const tenantCode = String(tenant.code);
    return {
      id: tenantId,
      code: tenantCode,
      name: String(tenant.name),
      is_active: Boolean(tenant.is_active),
      package_name: tenant.package_id ? packageById.get(String(tenant.package_id)) ?? null : null,
      // Managed store codes (FG/FF) live in tenants.code. tenant_access_codes is a separate customer/demo access credential.
      store_code: tenantCode,
      access_code: accessCodeByTenant.get(tenantId) ?? null,
      branch_count: count(branches as Array<{ tenant_id: string; is_active: boolean }>, tenantId),
      active_branch_count: count(branches as Array<{ tenant_id: string; is_active: boolean }>, tenantId, (r) => Boolean(r.is_active)),
      device_count: count(devices as Array<{ tenant_id: string; status: string; last_seen_at: string | null }>, tenantId),
      live_device_count: count(devices as Array<{ tenant_id: string; status: string; last_seen_at: string | null }>, tenantId, (r) => r.status === "active" && Boolean(r.last_seen_at && r.last_seen_at >= liveSince)),
      active_session_count: count(sessions as Array<{ tenant_id: string; expires_at: string }>, tenantId, (r) => r.expires_at > new Date().toISOString()),
      open_shift_count: count(shifts as Array<{ tenant_id: string }>, tenantId)
    };
  });

  const [livePrintAgents, printBacklog, openIncidents, qrFailures15m] = await Promise.all([
    safeCount(supabase.from("print_agents").select("id", { count: "exact", head: true }).gte("last_seen_at", liveSince)),
    safeCount(supabase.from("print_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "retrying"])),
    safeCount(supabase.from("pos_device_incidents").select("id", { count: "exact", head: true }).is("resolved_at", null)),
    safeCount(supabase.from("table_qr_timeline_events").select("id", { count: "exact", head: true }).eq("success", false).gte("event_at", qrSince))
  ]);

  return {
    generated_at: new Date().toISOString(),
    stores,
    totals: {
      active_stores: stores.filter((s) => s.is_active).length,
      provisioning_stores: stores.filter((s) => !s.is_active).length,
      devices: stores.reduce((sum, s) => sum + s.device_count, 0),
      live_devices: stores.reduce((sum, s) => sum + s.live_device_count, 0),
      live_print_agents: livePrintAgents,
      print_backlog: printBacklog,
      open_incidents: openIncidents,
      qr_failures_15m: qrFailures15m
    }
  };
}
