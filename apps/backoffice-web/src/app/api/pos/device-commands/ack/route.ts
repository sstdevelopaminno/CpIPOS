import { isDeviceCommandType, UNSUPPORTED_DEVICE_COMMAND_TYPES } from "@/lib/device-commands";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type AckResultInput = {
  id?: unknown;
  command_type?: unknown;
  applied?: unknown;
  phase?: unknown;
  error_code?: unknown;
  error_message?: unknown;
};

type AckBody = {
  results?: unknown;
  agent_surface?: unknown;
  agent_version?: unknown;
};

function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    const session = scope.session;
    const supabase = getSupabaseServiceClient();
    const body = (await request.json().catch(() => null)) as AckBody | null;
    const rawResults = Array.isArray(body?.results) ? body.results.slice(0, 10) : [];

    if (!rawResults.length) {
      return fail("device_command_ack_empty", "At least one command result is required.", 422);
    }

    let deviceId = session.device_id;
    if (!deviceId && session.device_code) {
      const { data: device, error: deviceError } = await supabase
        .from("branch_devices")
        .select("id")
        .eq("tenant_id", session.tenant_id)
        .eq("branch_id", session.branch_id)
        .eq("device_code", session.device_code)
        .eq("is_active", true)
        .maybeSingle();
      if (deviceError) throw deviceError;
      deviceId = device?.id ? String(device.id) : null;
    }

    if (!deviceId) {
      return fail("device_command_ack_device_missing", "The active POS session is not bound to a device.", 409);
    }

    const normalized = rawResults
      .map((value) => {
        const item = jsonRecord(value) as AckResultInput;
        const id = text(item.id, 80);
        const commandType = text(item.command_type, 80);
        if (!id || !isDeviceCommandType(commandType) || typeof item.applied !== "boolean") return null;
        return {
          id,
          commandType,
          applied: item.applied,
          phase: item.phase === "accepted" ? "accepted" : "executed",
          errorCode: text(item.error_code, 120),
          errorMessage: text(item.error_message, 500)
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (!normalized.length) {
      return fail("device_command_ack_invalid", "No valid command results were provided.", 422);
    }

    const ids = normalized.map((item) => item.id);
    const { data: commands, error: commandError } = await supabase
      .from("device_commands")
      .select("id,command_type,status,result")
      .eq("tenant_id", session.tenant_id)
      .eq("branch_id", session.branch_id)
      .eq("pos_device_id", deviceId)
      .in("id", ids);
    if (commandError) throw commandError;

    const commandById = new Map((commands ?? []).map((row) => [String(row.id), row]));
    const reportedAt = new Date().toISOString();
    let acknowledged = 0;
    let ignored = 0;

    for (const result of normalized) {
      const command = commandById.get(result.id);
      if (!command || String(command.command_type) !== result.commandType || String(command.status) !== "delivered") {
        ignored += 1;
        continue;
      }

      const unsupported = UNSUPPORTED_DEVICE_COMMAND_TYPES.includes(result.commandType);
      const executionStatus = unsupported
        ? "unsupported"
        : result.phase === "accepted"
          ? "accepted"
          : result.applied
            ? "succeeded"
            : "failed";
      const previous = jsonRecord(command.result);
      const nextResult = {
        ...previous,
        execution_status: executionStatus,
        applied: result.applied,
        command_type: result.commandType,
        phase: result.phase,
        reported_at: reportedAt,
        pos_session_id: session.id,
        agent_surface: text(body?.agent_surface, 80),
        agent_version: text(body?.agent_version, 120),
        error_code: result.errorCode,
        error_message: result.errorMessage
      };

      const { error: updateError } = await supabase
        .from("device_commands")
        .update({ result: nextResult })
        .eq("id", result.id)
        .eq("tenant_id", session.tenant_id)
        .eq("branch_id", session.branch_id)
        .eq("pos_device_id", deviceId)
        .eq("status", "delivered");
      if (updateError) throw updateError;
      acknowledged += 1;
    }

    const response = ok({ acknowledged, ignored, reported_at: reportedAt });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("device_command_ack_failed", error instanceof Error ? error.message : "Unable to acknowledge device commands.", 500);
  }
}
