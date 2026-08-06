import { UNSUPPORTED_DEVICE_COMMAND_TYPES, type PendingDeviceAction } from "./device-commands";

const MACHINE_ID_KEY = "cpi_mobile_machine_id_v1";

export type DeviceHeartbeatReason = "startup" | "interval" | "online" | "offline" | "visible";

export type DeviceHeartbeatPayload = {
  identity: {
    device_code: string;
    machine_id: string;
    app_version?: string | null;
  };
  connectivity: {
    internet_online: boolean;
    server_reachable: boolean;
    network_type: string;
    latency_ms: number;
    last_seen_at: string;
  };
  system: {
    os_name: string | null;
  };
  runtime: {
    cpi_windows_runtime_running: false;
    local_bridge_online: false;
  };
  peripherals: Record<string, never>;
  metadata: Record<string, unknown>;
  captured_at: string;
};

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable - heartbeat still sends with an in-memory id.
  }
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function resolveMachineId(): string {
  const existing = readLocalStorage(MACHINE_ID_KEY);
  if (existing) return existing;
  const generated = `mob-${randomId()}`;
  writeLocalStorage(MACHINE_ID_KEY, generated);
  return generated;
}

export function buildHeartbeatPayload(input: { deviceCode: string; machineId: string; startedAt: number; reason: DeviceHeartbeatReason }): DeviceHeartbeatPayload {
  const capturedAt = new Date().toISOString();
  const browserOnline = typeof navigator === "undefined" ? true : navigator.onLine;

  return {
    identity: {
      device_code: input.deviceCode,
      machine_id: input.machineId,
      app_version: null
    },
    connectivity: {
      internet_online: browserOnline,
      server_reachable: true,
      network_type: "mobile_web",
      latency_ms: Date.now() - input.startedAt,
      last_seen_at: capturedAt
    },
    system: {
      os_name: typeof navigator === "undefined" ? null : navigator.userAgent
    },
    runtime: {
      cpi_windows_runtime_running: false,
      local_bridge_online: false
    },
    peripherals: {},
    metadata: {
      source: "cpipos_mobile_web_heartbeat",
      reason: input.reason
    },
    captured_at: capturedAt
  };
}

type DeviceHeartbeatResponse = {
  data?: {
    pending_actions?: PendingDeviceAction[];
  } | null;
};

export async function sendDeviceHeartbeat(payload: DeviceHeartbeatPayload): Promise<PendingDeviceAction[]> {
  try {
    const response = await fetch("/api/mobile/device-heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(payload)
    });
    if (!response.ok) return [];
    const body = (await response.json().catch(() => null)) as DeviceHeartbeatResponse | null;
    return body?.data?.pending_actions ?? [];
  } catch {
    return [];
  }
}

export type ExecutedDeviceAction = {
  id: string;
  command_type: PendingDeviceAction["command_type"];
  applied: boolean;
};

// Executes the safe, fixed allowlist of device commands - never evaluates arbitrary
// code/payloads, only the known command_type values are ever acted on.
export function executePendingActions(actions: readonly PendingDeviceAction[]): ExecutedDeviceAction[] {
  const results: ExecutedDeviceAction[] = [];

  for (const action of actions) {
    if (UNSUPPORTED_DEVICE_COMMAND_TYPES.includes(action.command_type)) {
      results.push({ id: action.id, command_type: action.command_type, applied: false });
      continue;
    }

    if (action.command_type === "reload_ui") {
      results.push({ id: action.id, command_type: action.command_type, applied: true });
      if (typeof window !== "undefined") window.location.reload();
      continue;
    }

    // request_diagnostics_bundle / refresh_config / disable_device / enable_device:
    // already satisfied by the heartbeat that delivered them (fresh snapshot just
    // sent, disable/enable already applied server-side to branch_devices.status).
    results.push({ id: action.id, command_type: action.command_type, applied: true });
  }

  return results;
}
