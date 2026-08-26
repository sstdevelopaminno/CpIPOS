import {
  buildDeviceMdmHealthSnapshot,
  summarizeDeviceMdmHealth,
  type DeviceMdmConnectivity,
  type DeviceMdmHealthInput,
  type DeviceMdmIdentity,
  type DeviceMdmOfflineSaleHealth,
  type DeviceMdmPeripheralHealth,
  type DeviceMdmRuntimeHealth,
  type DeviceMdmSecuritySignal,
  type DeviceMdmSystemHealth
} from "@/lib/device-mdm-diagnostics";
import type { PendingDeviceAction } from "@/lib/device-commands";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type DeviceHeartbeatPayload = Partial<Omit<DeviceMdmHealthInput, "identity">> & {
  identity?: Partial<DeviceMdmIdentity> | null;
};

type SupabaseInsertResult = {
  id?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function sanitizeSecuritySignals(value: unknown): DeviceMdmSecuritySignal[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(isRecord)
    .map((item) => ({
      code: sanitizeText(item.code, "unknown"),
      severity: item.severity === "critical" || item.severity === "warning" || item.severity === "info" ? item.severity : "warning",
      message: sanitizeText(item.message, "Device reported a security signal."),
      captured_at: sanitizeText(item.captured_at, new Date().toISOString()),
      metadata: isRecord(item.metadata) ? item.metadata : null
    }));
}

type PendingDeviceCommandRow = {
  id: string;
  command_type: string;
  issued_at: string;
};

async function deliverPendingDeviceCommands(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  posDeviceId: string | null
): Promise<PendingDeviceAction[]> {
  if (!posDeviceId) return [];

  const nowIso = new Date().toISOString();

  await supabase
    .from("device_commands")
    .update({ status: "expired" })
    .eq("pos_device_id", posDeviceId)
    .eq("status", "pending")
    .lte("expires_at", nowIso);

  const { data: pendingRows, error: pendingError } = await supabase
    .from("device_commands")
    .select("id,command_type,issued_at")
    .eq("pos_device_id", posDeviceId)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("issued_at", { ascending: true })
    .limit(10)
    .returns<PendingDeviceCommandRow[]>();

  if (pendingError || !pendingRows || pendingRows.length === 0) return [];

  const ids = pendingRows.map((row) => row.id);
  await supabase
    .from("device_commands")
    .update({ status: "delivered", delivered_at: nowIso })
    .in("id", ids);

  return pendingRows.map((row) => ({
    id: row.id,
    command_type: row.command_type as PendingDeviceAction["command_type"],
    issued_at: row.issued_at
  }));
}

function mapDeviceHeartbeatError(error: unknown) {
  if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message.includes("JSON")) return fail("invalid_payload", "Invalid device heartbeat payload.", 400);
  if (message.includes("pos_session")) return fail("pos_session_required", "A valid POS session is required to send device heartbeat.", 401);
  return fail("device_heartbeat_failed", "Device heartbeat could not be saved.", 500);
}

export async function POST(req: Request) {
  try {
    const scope = await requirePosSession();
    const body = (await req.json().catch(() => ({}))) as DeviceHeartbeatPayload;
    const bodyIdentity = isRecord(body.identity) ? body.identity : {};

    const reportedDeviceCode = sanitizeText(bodyIdentity.device_code);
    const sessionDeviceCode = sanitizeText(scope.session.device_code, "POS-DEVICE");
    const deviceCode = sessionDeviceCode;
    const machineId = sanitizeText(bodyIdentity.machine_id, deviceCode);
    const capturedAt = sanitizeText(body.captured_at, new Date().toISOString());

    const input: DeviceMdmHealthInput = {
      identity: {
        tenant_id: scope.session.tenant_id,
        branch_id: scope.session.branch_id,
        device_code: deviceCode,
        machine_id: machineId,
        hostname: typeof bodyIdentity.hostname === "string" ? bodyIdentity.hostname : null,
        windows_username: typeof bodyIdentity.windows_username === "string" ? bodyIdentity.windows_username : null,
        runtime_version: typeof bodyIdentity.runtime_version === "string" ? bodyIdentity.runtime_version : null,
        app_version: typeof bodyIdentity.app_version === "string" ? bodyIdentity.app_version : null
      },
      connectivity: {
        internet_online: body.connectivity?.internet_online !== false,
        server_reachable: body.connectivity?.server_reachable ?? true,
        dns_healthy: body.connectivity?.dns_healthy ?? null,
        network_type: body.connectivity?.network_type ?? null,
        ip_address: body.connectivity?.ip_address ?? null,
        latency_ms: body.connectivity?.latency_ms ?? null,
        offline_since: body.connectivity?.offline_since ?? null,
        last_seen_at: body.connectivity?.last_seen_at ?? capturedAt
      } satisfies DeviceMdmConnectivity,
      system: (isRecord(body.system) ? body.system : {}) as DeviceMdmSystemHealth,
      runtime: {
        cpi_windows_runtime_running: body.runtime?.cpi_windows_runtime_running !== false,
        local_bridge_online: body.runtime?.local_bridge_online !== false,
        bridge_version: body.runtime?.bridge_version ?? null,
        bridge_port: body.runtime?.bridge_port ?? null,
        token_required: body.runtime?.token_required ?? null,
        request_slots_available: body.runtime?.request_slots_available ?? null,
        print_queue_busy: body.runtime?.print_queue_busy ?? null,
        drawer_queue_busy: body.runtime?.drawer_queue_busy ?? null,
        printed_jobs: body.runtime?.printed_jobs ?? null,
        failed_jobs: body.runtime?.failed_jobs ?? null,
        drawer_commands: body.runtime?.drawer_commands ?? null,
        last_error: body.runtime?.last_error ?? null
      } satisfies DeviceMdmRuntimeHealth,
      peripherals: (isRecord(body.peripherals) ? body.peripherals : {}) as DeviceMdmPeripheralHealth,
      offline_sale: body.offline_sale ? ((isRecord(body.offline_sale) ? body.offline_sale : {}) as DeviceMdmOfflineSaleHealth) : null,
      security_signals: sanitizeSecuritySignals(body.security_signals),
      metadata: {
        ...sanitizeRecord(body.metadata),
        reported_device_code: reportedDeviceCode || null,
        authoritative_device_code_source: "pos_session"
      },
      captured_at: capturedAt
    };

    const snapshot = buildDeviceMdmHealthSnapshot(input);
    const summary = summarizeDeviceMdmHealth(snapshot);
    const supabase = getSupabaseServiceClient();

    const latestPayload = {
      tenant_id: scope.session.tenant_id,
      branch_id: scope.session.branch_id,
      pos_device_id: scope.session.device_id ?? null,
      pos_session_id: scope.session.id,
      device_code: deviceCode,
      machine_id: machineId,
      hostname: snapshot.identity.hostname ?? null,
      windows_username: snapshot.identity.windows_username ?? null,
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
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: latestRow, error: latestError } = await supabase
      .from("pos_device_health_latest")
      .upsert(latestPayload, { onConflict: "tenant_id,branch_id,device_code,machine_id" })
      .select("id")
      .single<SupabaseInsertResult>();

    if (latestError) throw latestError;

    const criticalCount = snapshot.incidents.filter((incident) => incident.severity === "critical").length;
    const warningCount = snapshot.incidents.filter((incident) => incident.severity === "warning").length;
    const infoCount = snapshot.incidents.filter((incident) => incident.severity === "info").length;

    const { data: snapshotRow, error: snapshotError } = await supabase
      .from("pos_device_health_snapshots")
      .insert({
        latest_id: latestRow?.id ?? null,
        tenant_id: scope.session.tenant_id,
        branch_id: scope.session.branch_id,
        pos_device_id: scope.session.device_id ?? null,
        pos_session_id: scope.session.id,
        device_code: deviceCode,
        machine_id: machineId,
        status: snapshot.status,
        summary,
        payload: snapshot,
        incident_count: snapshot.incidents.length,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
        captured_at: snapshot.captured_at
      })
      .select("id")
      .single<SupabaseInsertResult>();

    if (snapshotError) throw snapshotError;

    if (snapshot.incidents.length > 0) {
      const { error: incidentError } = await supabase.from("pos_device_incidents").insert(
        snapshot.incidents.map((incident) => ({
          latest_id: latestRow?.id ?? null,
          snapshot_id: snapshotRow?.id ?? null,
          tenant_id: scope.session.tenant_id,
          branch_id: scope.session.branch_id,
          pos_device_id: scope.session.device_id ?? null,
          pos_session_id: scope.session.id,
          device_code: deviceCode,
          machine_id: machineId,
          code: incident.code,
          severity: incident.severity,
          title: incident.title,
          message: incident.message,
          metadata: incident.metadata ?? {},
          detected_at: incident.detected_at
        }))
      );

      if (incidentError) throw incidentError;
    }

    const pendingActions = await deliverPendingDeviceCommands(supabase, scope.session.device_id ?? null);

    return ok({
      accepted: true,
      latest_id: latestRow?.id ?? null,
      snapshot_id: snapshotRow?.id ?? null,
      status: snapshot.status,
      summary,
      incident_count: snapshot.incidents.length,
      captured_at: snapshot.captured_at,
      pending_actions: pendingActions
    });
  } catch (error) {
    return mapDeviceHeartbeatError(error);
  }
}
