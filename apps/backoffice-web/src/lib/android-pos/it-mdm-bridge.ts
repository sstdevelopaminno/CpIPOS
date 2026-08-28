import "server-only";

import {
  buildDeviceMdmHealthSnapshot,
  summarizeDeviceMdmHealth,
  type DeviceMdmHealthInput
} from "@/lib/device-mdm-diagnostics";
import { getTrialSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

export type AndroidMdmScope = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
};

export type AndroidMdmCommand = {
  id: string;
  action: string;
  reason: string;
  command_type: string;
};

type PendingCommandRow = {
  id: string;
  command_type: string;
  issued_at: string;
};

type DeliveredCommandRow = {
  id: string;
  command_type: string;
  result: JsonRecord | null;
};

type UnresolvedIncidentRow = {
  id: string;
  code: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function gbFromMb(value: unknown): number | null {
  const mb = finite(value);
  return mb === null ? null : Number((mb / 1024).toFixed(3));
}

function mapCommandToAction(commandType: string): string | null {
  switch (commandType) {
    case "request_diagnostics_bundle": return "collect_diagnostics";
    case "reload_ui": return "reload_webview";
    case "refresh_config": return "reload_webview";
    case "test_printer": return "test_printer_connection";
    default: return null;
  }
}

function commandTypesForAction(action: string): string[] {
  switch (action) {
    case "collect_diagnostics": return ["request_diagnostics_bundle"];
    case "reload_webview": return ["reload_ui", "refresh_config"];
    case "test_printer_connection": return ["test_printer"];
    default: return [];
  }
}

function normalizeInput(
  scope: AndroidMdmScope,
  payload: JsonRecord | null,
  installId: string,
  appVersionHeader: string | null
): DeviceMdmHealthInput {
  const app = asRecord(payload?.app);
  const device = asRecord(payload?.device);
  const network = asRecord(payload?.network);
  const health = asRecord(payload?.health);
  const webview = asRecord(payload?.webview);
  const printer = asRecord(payload?.printer);
  const capturedAt = new Date().toISOString();
  const totalStorageMb = finite(health.total_storage_mb);
  const availableStorageMb = finite(health.available_storage_mb);
  const diskUsedPercent = finite(health.storage_used_percent) ?? (
    totalStorageMb != null && totalStorageMb > 0 && availableStorageMb != null
      ? Math.max(0, Math.min(100, ((totalStorageMb - availableStorageMb) / totalStorageMb) * 100))
      : null
  );
  const printerHost = text(printer.configured_host);
  const printerReachable = typeof printer.last_reachable === "boolean" ? printer.last_reachable : null;
  const printerError = text(printer.last_error);
  const lastPageError = text(webview.last_page_error);

  return {
    identity: {
      tenant_id: scope.tenant_id,
      branch_id: scope.branch_id,
      device_code: scope.device_code,
      machine_id: `and-${installId}`,
      hostname: text(device.model),
      runtime_version: text(app.runtime) ?? "android-pos-webview-mdm-lite",
      app_version: text(app.version_name) ?? appVersionHeader
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
      uptime_seconds: finite(device.uptime_ms) != null ? Math.floor((finite(device.uptime_ms) ?? 0) / 1000) : null,
      cpu_percent: finite(health.cpu_percent),
      memory_percent: finite(health.memory_percent),
      disk_total_gb: gbFromMb(health.total_storage_mb),
      disk_free_gb: gbFromMb(health.available_storage_mb),
      disk_used_percent: diskUsedPercent,
      power_status: finite(health.battery_percent) != null ? `battery_${Math.round(finite(health.battery_percent) ?? 0)}pct` : null
    },
    runtime: {
      cpi_windows_runtime_running: false,
      local_bridge_online: false,
      bridge_version: text(app.runtime),
      last_error: lastPageError ?? printerError
    },
    peripherals: {
      selected_printer: printerHost,
      selected_printer_valid: printerHost ? printerReachable : null,
      printer_status: printerHost == null
        ? "not_configured"
        : printerReachable === true
          ? "online"
          : printerReachable === false
            ? "error"
            : "unknown"
    },
    offline_sale: null,
    security_signals: null,
    metadata: {
      source: "android_pos_webview_mdm",
      telemetry_profile: "android",
      android_install_id: installId,
      app_memory_mb: finite(health.app_memory_mb),
      battery_percent: finite(health.battery_percent),
      device_owner: health.device_owner ?? null,
      webview,
      displays: asRecord(payload?.displays),
      update_capabilities: asRecord(payload?.update_capabilities),
      update_state: asRecord(payload?.update_state),
      reported_at_ms: finite(payload?.timestamp_ms)
    },
    captured_at: capturedAt
  };
}

async function syncIncidentLifecycle(
  scope: AndroidMdmScope,
  latestId: string | null,
  snapshotId: string | null,
  machineId: string,
  incidents: ReturnType<typeof buildDeviceMdmHealthSnapshot>["incidents"],
  nowIso: string
) {
  const itSupabase = getTrialSupabaseServiceClient();
  const actionable = incidents.filter((incident) => incident.severity === "critical" || incident.severity === "warning");
  const currentCodes = new Set(actionable.map((incident) => incident.code));
  const { data: unresolved, error } = await itSupabase
    .from("it_device_incidents")
    .select("id,code")
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("device_code", scope.device_code)
    .is("resolved_at", null)
    .returns<UnresolvedIncidentRow[]>();
  if (error) throw new Error(`it_incident_query_failed:${error.message}`);

  const unresolvedCodes = new Set((unresolved ?? []).map((row) => row.code));
  const resolveIds = (unresolved ?? []).filter((row) => !currentCodes.has(row.code)).map((row) => row.id);
  if (resolveIds.length > 0) {
    const { error: resolveError } = await itSupabase
      .from("it_device_incidents")
      .update({ resolved_at: nowIso, synced_at: nowIso })
      .in("id", resolveIds);
    if (resolveError) throw new Error(`it_incident_resolve_failed:${resolveError.message}`);
  }

  const newIncidents = actionable.filter((incident) => !unresolvedCodes.has(incident.code));
  if (newIncidents.length > 0) {
    const { error: insertError } = await itSupabase.from("it_device_incidents").insert(
      newIncidents.map((incident) => ({
        latest_id: latestId,
        snapshot_id: snapshotId,
        tenant_id: scope.tenant_id,
        branch_id: scope.branch_id,
        pos_device_id: scope.id,
        pos_session_id: null,
        device_code: scope.device_code,
        machine_id: machineId,
        code: incident.code,
        severity: incident.severity,
        title: incident.title,
        message: incident.message,
        metadata: incident.metadata ?? {},
        detected_at: incident.detected_at,
        synced_at: nowIso
      }))
    );
    if (insertError) throw new Error(`it_incident_insert_failed:${insertError.message}`);
  }
}

async function acknowledgePreviousItCommand(
  scope: AndroidMdmScope,
  payload: JsonRecord | null,
  appVersion: string | null
) {
  const lastCommand = asRecord(payload?.last_command);
  const action = text(lastCommand.action)?.toLowerCase() ?? "";
  const commandTypes = commandTypesForAction(action);
  if (commandTypes.length === 0) return;

  const atMs = finite(lastCommand.at_ms);
  if (atMs == null || atMs <= 0) return;
  const reportedAt = new Date(Math.min(atMs, Date.now())).toISOString();
  const lowerBound = new Date(Math.max(0, Math.min(atMs, Date.now()) - 10 * 60_000)).toISOString();
  const itSupabase = getTrialSupabaseServiceClient();
  const { data: row, error } = await itSupabase
    .from("it_device_commands")
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
  if (!row) return;

  const printer = asRecord(payload?.printer);
  const printerReachable = typeof printer.last_reachable === "boolean" ? printer.last_reachable : null;
  const succeeded = action === "test_printer_connection" ? printerReachable === true : true;
  const executionStatus = action === "test_printer_connection" && printerReachable == null
    ? "accepted"
    : succeeded
      ? "succeeded"
      : "failed";
  const previousResult = asRecord(row.result);
  const { error: updateError } = await itSupabase
    .from("it_device_commands")
    .update({
      result: {
        ...previousResult,
        execution_status: executionStatus,
        applied: succeeded,
        phase: executionStatus === "accepted" ? "accepted" : "executed",
        android_action: action,
        reported_at: new Date().toISOString(),
        device_reported_at: reportedAt,
        agent_surface: "android-pos-webview-mdm-lite",
        agent_version: appVersion,
        printer: action === "test_printer_connection" ? printer : undefined
      }
    })
    .eq("id", row.id)
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .eq("status", "delivered");
  if (updateError) throw new Error(`it_command_ack_update_failed:${updateError.message}`);
}

async function deliverItCommands(scope: AndroidMdmScope): Promise<AndroidMdmCommand[]> {
  const itSupabase = getTrialSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  await itSupabase
    .from("it_device_commands")
    .update({ status: "expired", synced_at: nowIso })
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .eq("status", "pending")
    .lte("expires_at", nowIso);

  const { data, error } = await itSupabase
    .from("it_device_commands")
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

  const deliverable = (data ?? [])
    .map((row) => ({ row, action: mapCommandToAction(row.command_type) }))
    .filter((item): item is { row: PendingCommandRow; action: string } => Boolean(item.action));
  if (deliverable.length === 0) return [];

  const ids = deliverable.map((item) => item.row.id);
  const { error: updateError } = await itSupabase
    .from("it_device_commands")
    .update({ status: "delivered", delivered_at: nowIso, synced_at: nowIso })
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id)
    .eq("pos_device_id", scope.id)
    .eq("status", "pending")
    .in("id", ids);
  if (updateError) throw new Error(`it_command_delivery_update_failed:${updateError.message}`);

  return deliverable.map(({ row, action }) => ({
    id: row.id,
    action,
    reason: "it_control_plane",
    command_type: row.command_type
  }));
}

export async function syncAndroidHeartbeatToItPlane(input: {
  scope: AndroidMdmScope;
  payload: JsonRecord | null;
  installId: string;
  appVersion: string | null;
}): Promise<{ commands: AndroidMdmCommand[]; latest_id: string | null; status: string }> {
  const { scope, payload, installId, appVersion } = input;
  const itSupabase = getTrialSupabaseServiceClient();
  const normalized = normalizeInput(scope, payload, installId, appVersion);
  const snapshot = buildDeviceMdmHealthSnapshot(normalized);
  const summary = summarizeDeviceMdmHealth(snapshot);
  const nowIso = new Date().toISOString();
  const machineId = snapshot.identity.machine_id;

  await acknowledgePreviousItCommand(scope, payload, snapshot.identity.app_version ?? appVersion);

  const latestPayload = {
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
  };

  const { data: latest, error: latestError } = await itSupabase
    .from("it_device_health_latest")
    .upsert(latestPayload, { onConflict: "tenant_id,branch_id,device_code,machine_id" })
    .select("id")
    .single<{ id: string }>();
  if (latestError) throw new Error(`it_health_latest_write_failed:${latestError.message}`);

  const { data: snapshotRow, error: snapshotError } = await itSupabase
    .from("it_device_health_snapshots")
    .insert({
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
    })
    .select("id")
    .single<{ id: string }>();
  if (snapshotError) throw new Error(`it_health_snapshot_write_failed:${snapshotError.message}`);

  await syncIncidentLifecycle(scope, latest?.id ?? null, snapshotRow?.id ?? null, machineId, snapshot.incidents, nowIso);

  const { error: deviceUpdateError } = await itSupabase
    .from("it_devices")
    .update({ last_seen_at: nowIso, synced_at: nowIso, source_updated_at: nowIso })
    .eq("id", scope.id)
    .eq("tenant_id", scope.tenant_id)
    .eq("branch_id", scope.branch_id);
  if (deviceUpdateError) throw new Error(`it_device_last_seen_update_failed:${deviceUpdateError.message}`);

  const commands = await deliverItCommands(scope);
  return { commands, latest_id: latest?.id ?? null, status: snapshot.status };
}
