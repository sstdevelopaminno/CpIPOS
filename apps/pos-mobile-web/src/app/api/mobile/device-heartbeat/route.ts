import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { fail, ok } from "@/lib/api/response";
import type { DeviceCommandType } from "@/lib/device-commands";

type DeviceHeartbeatBody = {
  identity?: { device_code?: string; machine_id?: string; app_version?: string | null } | null;
  connectivity?: { internet_online?: boolean } | null;
  system?: { os_name?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  captured_at?: string | null;
};

type PendingDeviceCommandRow = {
  id: string;
  command_type: string;
  issued_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function deliverPendingDeviceCommands(supabase: ReturnType<typeof createServiceClient>, posDeviceId: string | null) {
  if (!posDeviceId) return [] as { id: string; command_type: DeviceCommandType; issued_at: string }[];

  const nowIso = new Date().toISOString();

  await supabase.from("device_commands").update({ status: "expired" }).eq("pos_device_id", posDeviceId).eq("status", "pending").lte("expires_at", nowIso);

  const { data: pendingRows } = await supabase
    .from("device_commands")
    .select("id,command_type,issued_at")
    .eq("pos_device_id", posDeviceId)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("issued_at", { ascending: true })
    .limit(10)
    .returns<PendingDeviceCommandRow[]>();

  if (!pendingRows || pendingRows.length === 0) return [];

  const ids = pendingRows.map((row) => row.id);
  await supabase.from("device_commands").update({ status: "delivered", delivered_at: nowIso }).in("id", ids);

  return pendingRows.map((row) => ({ id: row.id, command_type: row.command_type as DeviceCommandType, issued_at: row.issued_at }));
}

export async function POST(req: Request) {
  const scope = await requireActiveMobileSession();
  if (!scope) return fail("session_required", "A valid mobile session is required to send device heartbeat.", 401);

  const body = (await req.json().catch(() => ({}))) as DeviceHeartbeatBody;
  const bodyIdentity = isRecord(body.identity) ? body.identity : {};
  const deviceCode = sanitizeText(bodyIdentity.device_code, scope.deviceCode);
  const machineId = sanitizeText(bodyIdentity.machine_id, deviceCode);
  const capturedAt = sanitizeText(body.captured_at, new Date().toISOString());
  const internetOnline = body.connectivity?.internet_online !== false;
  const status = internetOnline ? "healthy" : "offline";

  const supabase = createServiceClient();

  const { data: latestRow, error: latestError } = await supabase
    .from("pos_device_health_latest")
    .upsert(
      {
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        pos_device_id: scope.deviceId ?? null,
        pos_session_id: scope.sessionId,
        device_code: deviceCode,
        machine_id: machineId,
        app_version: typeof bodyIdentity.app_version === "string" ? bodyIdentity.app_version : null,
        status,
        summary: { status },
        identity: { device_code: deviceCode, machine_id: machineId },
        connectivity: { internet_online: internetOnline },
        system_health: isRecord(body.system) ? body.system : {},
        runtime_health: { cpi_windows_runtime_running: false, local_bridge_online: false },
        peripheral_health: {},
        offline_sale_health: {},
        security_signals: [],
        metadata: isRecord(body.metadata) ? body.metadata : {},
        captured_at: capturedAt,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      { onConflict: "tenant_id,branch_id,device_code,machine_id" }
    )
    .select("id")
    .single<{ id: string }>();

  if (latestError) return fail("device_heartbeat_failed", "Device heartbeat could not be saved.", 500);

  await supabase.from("pos_device_health_snapshots").insert({
    latest_id: latestRow?.id ?? null,
    tenant_id: scope.tenantId,
    branch_id: scope.branchId,
    pos_device_id: scope.deviceId ?? null,
    pos_session_id: scope.sessionId,
    device_code: deviceCode,
    machine_id: machineId,
    status,
    summary: { status },
    payload: { identity: { device_code: deviceCode, machine_id: machineId }, connectivity: { internet_online: internetOnline } },
    incident_count: 0,
    critical_count: 0,
    warning_count: 0,
    info_count: 0,
    captured_at: capturedAt
  });

  const pendingActions = await deliverPendingDeviceCommands(supabase, scope.deviceId ?? null);

  return ok({
    accepted: true,
    latest_id: latestRow?.id ?? null,
    status,
    captured_at: capturedAt,
    pending_actions: pendingActions
  });
}
