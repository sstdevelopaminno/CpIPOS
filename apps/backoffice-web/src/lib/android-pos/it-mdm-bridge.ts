import "server-only";

import {
  buildDeviceMdmHealthSnapshot,
  summarizeDeviceMdmHealth,
  type DeviceMdmHealthInput
} from "@/lib/device-mdm-diagnostics";
import { getTrialSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;
export type AndroidMdmScope = { id: string; tenant_id: string; branch_id: string; device_code: string };
export type AndroidMdmCommand = { id: string; action: string; reason: string; command_type: string };
type PendingCommandRow = { id: string; command_type: string; issued_at: string };
type DeliveredCommandRow = { id: string; command_type: string; result: JsonRecord | null };
type UnresolvedIncidentRow = { id: string; code: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function gb(value: unknown): number | null {
  const mb = number(value);
  return mb === null ? null : Number((mb / 1024).toFixed(3));
}
function actionFor(commandType: string): string | null {
  if (commandType === "request_diagnostics_bundle") return "collect_diagnostics";
  if (commandType === "reload_ui" || commandType === "refresh_config") return "reload_webview";
  if (commandType === "test_printer") return "test_printer_connection";
  return null;
}
function typesForAction(action: string): string[] {
  if (action === "collect_diagnostics") return ["request_diagnostics_bundle"];
  if (action === "reload_webview") return ["reload_ui", "refresh_config"];
  if (action === "test_printer_connection") return ["test_printer"];
  return [];
}

function normalize(scope: AndroidMdmScope, payload: JsonRecord | null, installId: string, appVersion: string | null): DeviceMdmHealthInput {
  const app = record(payload?.app);
  const device = record(payload?.device);
  const network = record(payload?.network);
  const health = record(payload?.health);
  const webview = record(payload?.webview);
  const printer = record(payload?.printer);
  const totalMb = number(health.total_storage_mb);
  const freeMb = number(health.available_storage_mb);
  const usedPercent = number(health.storage_used_percent) ?? (
    totalMb != null && totalMb > 0 && freeMb != null
      ? Math.max(0, Math.min(100, ((totalMb - freeMb) / totalMb) * 100))
      : null
  );
  const printerHost = text(printer.configured_host);
  const printerReachable = typeof printer.last_reachable === "boolean" ? printer.last_reachable : null;
  const capturedAt = new Date().toISOString();

  return {
    identity: {
      tenant_id: scope.tenant_id,
      branch_id: scope.branch_id,
      device_code: scope.device_code,
      machine_id: `and-${installId}`,
      hostname: text(device.model),
      runtime_version: text(app.runtime) ?? "android-pos-webview-mdm-lite",
      app_version: text(app.version_name) ?? appVersion
    },
    connectivity: {
      internet_online: network.online === true,
      server_reachable: true,
      dns_healthy: null,
      network_type: text(network.type) ?? "android",
      last_seen_at: capturedAt
    },
    system: {
      os_name: "Android",
      os_version: text(device.android_release),
      uptime_seconds: number(device.uptime_ms) != null ? Math.floor((number(device.uptime_ms) ?? 0) / 1000) : null,
      cpu_percent: number(health.cpu_percent),
      memory_percent: number(health.memory_percent),
      disk_total_gb: gb(health.total_storage_mb),
      disk_free_gb: gb(health.available_storage_mb),
      disk_used_percent: usedPercent,
      power_status: number(health.battery_percent) != null ? `battery_${Math.round(number(health.battery_percent) ?? 0)}pct` : null
    },
    runtime: {
      cpi_windows_runtime_running: false,
      local_bridge_online: false,
      bridge_version: text(app.runtime),
      last_error: text(webview.last_page_error) ?? text(printer.last_error)
    },
    peripherals: {
      selected_printer: printerHost,
      selected_printer_valid: printerHost ? printerReachable : null,
      printer_status: printerHost == null ? "not_configured" : printerReachable === true ? "online" : printerReachable === false ? "error" : "unknown"
    },
    offline_sale: null,
    security_signals: null,
    metadata: {
      source: "android_pos_webview_mdm",
      telemetry_profile: "android",
      android_install_id: installId,
      app_memory_mb: number(health.app_memory_mb),
      battery_percent: number(health.battery_percent),
      device_owner: health.device_owner ?? null,
      webview,
      displays: record(payload?.displays),
      update_capabilities: record(payload?.update_capabilities),
      update_state: record(payload?.update_state),
      reported_at_ms: number(payload?.timestamp_ms)
    },
    captured_at: capturedAt
  };
}

async function updateIncidents(scope: AndroidMdmScope, latestId: string | null, snapshotId: string | null, machineId: string, snapshot: ReturnType<typeof buildDeviceMdmHealthSnapshot>, nowIso: string) {
  const db = getTrialSupabaseServiceClient();
  const actionable = snapshot.incidents.filter((row) => row.severity === "critical" || row.severity === "warning");
  const currentCodes = new Set<string>(actionable.map((row) => row.code));
  const { data: unresolved, error } = await db.from("it_device_incidents")
    .select("id,code")
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("device_code", scope.device_code)
    .is("resolved_at", null)
    .returns<UnresolvedIncidentRow[]>();
  if (error) throw new Error(`it_incident_query_failed:${error.message}`);

  const existingCodes = new Set<string>((unresolved ?? []).map((row) => row.code));
  const resolvedIds = (unresolved ?? []).filter((row) => !currentCodes.has(row.code)).map((row) => row.id);
  if (resolvedIds.length) {
    const { error: resolveError } = await db.from("it_device_incidents")
      .update({ resolved_at: nowIso, synced_at: nowIso })
      .in("id", resolvedIds);
    if (resolveError) throw new Error(`it_incident_resolve_failed:${resolveError.message}`);
  }

  const newRows = actionable.filter((row) => !existingCodes.has(row.code));
  if (newRows.length) {
    const { error: insertError } = await db.from("it_device_incidents").insert(newRows.map((row) => ({
      latest_id: latestId,
      snapshot_id: snapshotId,
      tenant_id: scope.tenant_id,
      branch_id: scope.branch_id,
      pos_device_id: scope.id,
      pos_session_id: null,
      device_code: scope.device_code,
      machine_id: machineId,
      code: row.code,
      severity: row.severity,
      title: row.title,
      message: row.message,
      metadata: row.metadata ?? {},
      detected_at: row.detected_at,
      synced_at: nowIso
    })));
    if (insertError) throw new Error(`it_incident_insert_failed:${insertError.message}`);
  }
}

async function acknowledge(scope: AndroidMdmScope, payload: JsonRecord | null, appVersion: string | null) {
  const lastCommand = record(payload?.last_command);
  const action = text(lastCommand.action)?.toLowerCase() ?? "";
  const commandTypes = typesForAction(action);
  const atMs = number(lastCommand.at_ms);
  if (!commandTypes.length || atMs == null || atMs <= 0) return;

  const safeMs = Math.min(atMs, Date.now());
  const reportedAt = new Date(safeMs).toISOString();
  const lowerBound = new Date(Math.max(0, safeMs - 10 * 60_000)).toISOString();
  const db = getTrialSupabaseServiceClient();
  const { data: command, error } = await db.from("it_device_commands")
    .select("id,command_type,result")
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .in("command_type", commandTypes)
    .eq("status", "delivered")
    .gte("delivered_at", lowerBound)
    .lte("delivered_at", reportedAt)
    .order("delivered_at", { ascending: false })
    .limit(1)
    .maybeSingle<DeliveredCommandRow>();
  if (error) throw new Error(`it_command_ack_query_failed:${error.message}`);
  if (!command) return;

  const printer = record(payload?.printer);
  const reachable = typeof printer.last_reachable === "boolean" ? printer.last_reachable : null;
  const executionStatus = action === "test_printer_connection" ? reachable === true ? "succeeded" : reachable === false ? "failed" : "accepted" : "succeeded";
  const { error: updateError } = await db.from("it_device_commands").update({
    result: {
      ...record(command.result),
      execution_status: executionStatus,
      applied: executionStatus === "succeeded",
      phase: executionStatus === "accepted" ? "accepted" : "executed",
      android_action: action,
      reported_at: new Date().toISOString(),
      device_reported_at: reportedAt,
      agent_surface: "android-pos-webview-mdm-lite",
      agent_version: appVersion,
      ...(action === "test_printer_connection" ? { printer } : {})
    }
  })
    .eq("id", command.id)
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .eq("status", "delivered");
  if (updateError) throw new Error(`it_command_ack_update_failed:${updateError.message}`);
}

async function deliver(scope: AndroidMdmScope): Promise<AndroidMdmCommand[]> {
  const db = getTrialSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  await db.from("it_device_commands")
    .update({ status: "expired" })
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .eq("status", "pending")
    .lte("expires_at", nowIso);

  const { data, error } = await db.from("it_device_commands")
    .select("id,command_type,issued_at")
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("issued_at", { ascending: true })
    .limit(5)
    .returns<PendingCommandRow[]>();
  if (error) throw new Error(`it_command_delivery_query_failed:${error.message}`);

  const rows = (data ?? []).map((row) => ({ row, action: actionFor(row.command_type) }))
    .filter((item): item is { row: PendingCommandRow; action: string } => Boolean(item.action));
  if (!rows.length) return [];

  const { error: updateError } = await db.from("it_device_commands")
    .update({ status: "delivered", delivered_at: nowIso })
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .eq("status", "pending")
    .in("id", rows.map((item) => item.row.id));
  if (updateError) throw new Error(`it_command_delivery_update_failed:${updateError.message}`);

  return rows.map(({ row, action }) => ({ id: row.id, action, reason: "it_control_plane", command_type: row.command_type }));
}

export async function syncAndroidHeartbeatToItPlane(input: { scope: AndroidMdmScope; payload: JsonRecord | null; installId: string; appVersion: string | null }) {
  const { scope, payload, installId, appVersion } = input;
  const db = getTrialSupabaseServiceClient();
  const snapshot = buildDeviceMdmHealthSnapshot(normalize(scope, payload, installId, appVersion));
  const summary = summarizeDeviceMdmHealth(snapshot);
  const nowIso = new Date().toISOString();
  const machineId = snapshot.identity.machine_id;

  await acknowledge(scope, payload, snapshot.identity.app_version ?? appVersion);

  const { data: latest, error: latestError } = await db.from("it_device_health_latest").upsert({
    tenant_id: scope.tenant_id,
    branch_id: scope.branch_id,
    pos_device_id: scope.id,
    pos_session_id: null,
    device_code: scope.device_code,
    machine_id: machineId,
    hostname: snapshot.identity.hostname ?? null,
    windows_username: null,
    runtime_version: snapshot.identity.runtime_version ?? null,
    app_version: snapshot.identity.app_version ?? null,
    status: snapshot.status,
    summary,
    identity: snapshot.identity,
    connectivity: snapshot.connectivity,
    system_health: snapshot.system,
    runtime_health: snapshot.runtime,
    peripheral_health: snapshot.peripherals,
    offline_sale_health: snapshot.offline_sale ?? {},
    security_signals: snapshot.security_signals ?? [],
    metadata: snapshot.metadata ?? {},
    last_error: snapshot.runtime.last_error ?? null,
    captured_at: snapshot.captured_at,
    last_seen_at: nowIso,
    source_updated_at: nowIso,
    synced_at: nowIso
  }, { onConflict: "tenant_id,branch_id,device_code,machine_id" }).select("id").single<{ id: string }>();
  if (latestError) throw new Error(`it_health_latest_write_failed:${latestError.message}`);

  const { data: history, error: historyError } = await db.from("it_device_health_snapshots").insert({
    latest_id: latest?.id ?? null,
    tenant_id: scope.tenant_id,
    branch_id: scope.branch_id,
    pos_device_id: scope.id,
    pos_session_id: null,
    device_code: scope.device_code,
    machine_id: machineId,
    status: snapshot.status,
    summary,
    payload: snapshot,
    incident_count: snapshot.incidents.length,
    critical_count: snapshot.incidents.filter((row) => row.severity === "critical").length,
    warning_count: snapshot.incidents.filter((row) => row.severity === "warning").length,
    info_count: snapshot.incidents.filter((row) => row.severity === "info").length,
    captured_at: snapshot.captured_at
  }).select("id").single<{ id: string }>();
  if (historyError) throw new Error(`it_health_snapshot_write_failed:${historyError.message}`);

  await updateIncidents(scope, latest?.id ?? null, history?.id ?? null, machineId, snapshot, nowIso);

  const { error: deviceError } = await db.from("it_devices").update({
    last_seen_at: nowIso,
    source_updated_at: nowIso,
    synced_at: nowIso
  }).eq("id", scope.id).eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id);
  if (deviceError) throw new Error(`it_device_last_seen_update_failed:${deviceError.message}`);

  const commands = await deliver(scope);
  return { commands, latest_id: latest?.id ?? null, status: snapshot.status };
}
