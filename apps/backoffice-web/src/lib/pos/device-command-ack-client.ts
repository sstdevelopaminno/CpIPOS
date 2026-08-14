import type { DeviceHeartbeatSurface, ExecutedDeviceAction } from "@/lib/pos/device-heartbeat-client";

export type DeviceCommandAck = ExecutedDeviceAction & {
  phase?: "accepted" | "executed";
  error_code?: string | null;
  error_message?: string | null;
};

export async function acknowledgeDeviceCommands(
  results: readonly DeviceCommandAck[],
  surface: DeviceHeartbeatSurface,
  agentVersion: string | null = null
): Promise<boolean> {
  if (!results.length) return true;

  try {
    const response = await fetch("/api/pos/device-commands/ack", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_surface: surface,
        agent_version: agentVersion,
        results: results.map((result) => ({
          id: result.id,
          command_type: result.command_type,
          applied: result.applied,
          phase: result.phase ?? "executed",
          error_code: result.error_code ?? null,
          error_message: result.error_message ?? null
        }))
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}
