import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItSupport } from "@/lib/it-admin-guard";
import { getSupportCenterSnapshot, type SupportCenterSnapshot, type SupportDevice } from "@/lib/services/it-admin/support-center-service";

export const dynamic = "force-dynamic";

function ageSeconds(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 1000));
}

function chooseLatestTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function normalizeDevicePresence(device: SupportDevice, presenceAt: string | null, nowMs: number): SupportDevice {
  const effectiveLastSeen = chooseLatestTimestamp(device.last_seen_at, presenceAt);
  const seconds = ageSeconds(effectiveLastSeen, nowMs);
  const connectionState: SupportDevice["connection_state"] =
    seconds == null ? "never_seen" : seconds <= 120 ? "live" : seconds <= 600 ? "stale" : "offline";

  const coreIncidents = device.incidents.filter((incident) => incident.code !== "heartbeat_stale");
  const incidents: SupportDevice["incidents"] = [...coreIncidents];

  if (connectionState === "stale" || connectionState === "offline") {
    incidents.unshift({
      code: "heartbeat_stale",
      severity: connectionState === "offline" ? "critical" : "warning",
      title: connectionState === "offline" ? "POS device is offline" : "POS presence is stale",
      message:
        connectionState === "offline"
          ? "No POS presence has been observed for more than 10 minutes."
          : "POS presence is older than the normal live window.",
      detected_at: new Date(nowMs).toISOString()
    });
  }

  const critical = coreIncidents.some((incident) => incident.severity === "critical");
  const warning = coreIncidents.some((incident) => incident.severity === "warning");
  const effectiveStatus: SupportDevice["effective_status"] =
    connectionState === "offline" || connectionState === "never_seen"
      ? "offline"
      : critical
        ? "critical"
        : warning || connectionState === "stale"
          ? "degraded"
          : "healthy";
  const primaryIncident =
    incidents.find((incident) => incident.severity === "critical") ??
    incidents.find((incident) => incident.severity === "warning") ??
    incidents[0] ??
    null;

  return {
    ...device,
    connection_state: connectionState,
    effective_status: effectiveStatus,
    last_seen_at: effectiveLastSeen,
    last_seen_age_seconds: seconds,
    incidents,
    primary_incident: primaryIncident
      ? {
          code: primaryIncident.code,
          severity: primaryIncident.severity,
          title: primaryIncident.title,
          message: primaryIncident.message
        }
      : null
  };
}

async function applyLivePresence(
  snapshot: SupportCenterSnapshot,
  supabase: Awaited<ReturnType<typeof requireItSupport>>["supabase"]
): Promise<SupportCenterSnapshot> {
  if (!snapshot.devices.length) return snapshot;

  const { data, error } = await supabase
    .from("branch_devices")
    .select("id,last_seen_at")
    .eq("tenant_id", snapshot.tenant.id)
    .in("id", snapshot.devices.map((device) => device.id));

  if (error) return snapshot;

  const presenceById = new Map((data ?? []).map((row) => [String(row.id), row.last_seen_at ? String(row.last_seen_at) : null]));
  const nowMs = Date.now();
  const devices = snapshot.devices.map((device) => normalizeDevicePresence(device, presenceById.get(device.id) ?? null, nowMs));
  const incidents = devices
    .flatMap((device) =>
      device.incidents.map((incident) => ({
        ...incident,
        device_id: device.id,
        device_code: device.device_code,
        branch_name: device.branch_name
      }))
    )
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : b.severity === "critical" ? 1 : 0))
    .slice(0, 30);

  return {
    ...snapshot,
    devices,
    incidents,
    health: {
      registered_devices: devices.length,
      live: devices.filter((device) => device.connection_state === "live").length,
      stale: devices.filter((device) => device.connection_state === "stale").length,
      offline: devices.filter((device) => device.connection_state === "offline" || device.connection_state === "never_seen").length,
      healthy: devices.filter((device) => device.effective_status === "healthy").length,
      degraded: devices.filter((device) => device.effective_status === "degraded").length,
      critical: devices.filter((device) => device.effective_status === "critical").length,
      unknown: devices.filter((device) => device.effective_status === "unknown").length
    }
  };
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    const { supabase } = await requireItSupport();
    const url = new URL(request.url);
    const code = String(url.searchParams.get("code") ?? "").trim();

    if (!code) {
      throw new ItAdminGuardError("missing_store_code", "Store code is required.", 422);
    }

    if (code.length > 64 || !/^[A-Za-z0-9_-]+$/.test(code)) {
      throw new ItAdminGuardError("invalid_store_code", "Store code format is invalid.", 422);
    }

    const rawSnapshot = await getSupportCenterSnapshot(supabase, code);
    if (!rawSnapshot) {
      return fail("store_not_found", "No active customer store matches this code.", 404);
    }

    const snapshot = await applyLivePresence(rawSnapshot, supabase);
    const response = ok({ snapshot });
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const guarded = guardItAdminError(error);
    guarded.headers.set("cache-control", "no-store");
    guarded.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return guarded;
  }
}
