import "server-only";

import { evaluateMdmEligibility, type MdmCommandType } from "@/lib/mdm/eligibility";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type DeviceScope = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
};

type EnrollmentRow = {
  id: string;
  enrollment_status: string;
  trust_level: string;
  metadata: JsonRecord | null;
};

type MdmDeviceRow = {
  tenant_id: string;
  device_id: string;
  platform: string;
  app_version: string;
  app_flavor: string;
  native_generation: string | null;
  ownership_type: string;
  enrollment_mode: string;
  is_device_owner: boolean;
  is_full_mdm_eligible: boolean;
  capabilities: unknown;
};

type CommandRow = {
  id: string;
  command_type: MdmCommandType;
  reason: string | null;
  payload: JsonRecord | null;
  status: string;
  queued_at: string;
  picked_up_at: string | null;
  expires_at: string | null;
};

type ResultEnvelope = {
  command_id: string;
  status: "succeeded" | "failed";
  result: JsonRecord;
};

export type FullMdmCommandEnvelope = {
  id: string;
  command_type: MdmCommandType;
  reason: string | null;
  payload: JsonRecord;
  expires_at: string | null;
};

export type FullMdmHeartbeatResult = {
  status: "not_advertised" | "pending_enrollment" | "active" | "unavailable";
  device_id: string | null;
  eligible: boolean;
  mode: "full_mdm" | "diagnostics_only" | "not_available";
  reasons: string[];
  commands: FullMdmCommandEnvelope[];
  acknowledged_result_ids: string[];
};

const RESULT_LIMIT = 10;
const COMMAND_LIMIT = 3;
const RETRY_PICKUP_AFTER_MS = 2 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXECUTOR_COMMANDS = new Set<MdmCommandType>(["diagnostics_ping", "sync_policy"]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean))).slice(0, 24);
}

function boundedRecord(value: unknown): JsonRecord {
  const record = asRecord(value);
  try {
    const encoded = JSON.stringify(record);
    if (encoded.length <= 8_000) return record;
    return { truncated: true, original_bytes: encoded.length };
  } catch {
    return { invalid_result: true };
  }
}

function parseResults(payload: JsonRecord | null): ResultEnvelope[] {
  const raw = payload?.full_mdm_results;
  if (!Array.isArray(raw)) return [];
  const rows: ResultEnvelope[] = [];
  for (const item of raw.slice(0, RESULT_LIMIT)) {
    const row = asRecord(item);
    const commandId = String(row.command_id ?? "").trim();
    const status = String(row.status ?? "").trim().toLowerCase();
    if (!UUID_PATTERN.test(commandId) || (status !== "succeeded" && status !== "failed")) continue;
    rows.push({ command_id: commandId, status, result: boundedRecord(row.result) });
  }
  return rows;
}

async function loadTrustedEnrollment(scope: DeviceScope, installId: string): Promise<EnrollmentRow | null> {
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("device_enrollments")
    .select("id,enrollment_status,trust_level,metadata")
    .eq("tenant_id", scope.tenant_id)
    .eq("device_code", scope.device_code)
    .maybeSingle<EnrollmentRow>();

  if (error) throw new Error(`mdm_enrollment_lookup_failed:${error.message}`);
  if (!data || data.enrollment_status !== "active" || data.trust_level !== "trusted") return null;
  const enrolledInstallId = String(asRecord(data.metadata).android_mdm_install_id ?? "").trim();
  return enrolledInstallId === installId ? data : null;
}

async function upsertMdmDevice(input: {
  scope: DeviceScope;
  enrollment: EnrollmentRow;
  payload: JsonRecord | null;
  appVersion: string | null;
}): Promise<MdmDeviceRow> {
  const supabase = getPrimarySupabaseServiceClient();
  const fullMdm = asRecord(input.payload?.full_mdm);
  const enrollmentMetadata = asRecord(input.enrollment.metadata);
  const isDeviceOwner = fullMdm.is_device_owner === true;
  const ownershipType = String(enrollmentMetadata.mdm_ownership_type ?? "unknown").trim().toLowerCase() || "unknown";
  const capabilities = asStringArray(fullMdm.capabilities);
  const appFlavor = String(fullMdm.app_flavor ?? "web-production").trim().toLowerCase() || "web-production";
  const nativeGeneration = String(fullMdm.native_generation ?? "1.0").trim() || "1.0";
  const enrollmentMode = isDeviceOwner ? "android_enterprise_device_owner" : "none";
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("mdm_devices")
    .upsert({
      tenant_id: input.scope.tenant_id,
      device_id: input.scope.id,
      display_name: input.scope.device_code,
      platform: "android",
      app_version: input.appVersion ?? "unknown",
      app_flavor: appFlavor,
      native_generation: nativeGeneration,
      ownership_type: ownershipType,
      enrollment_mode: enrollmentMode,
      is_device_owner: isDeviceOwner,
      capabilities,
      last_heartbeat_at: nowIso,
      updated_at: nowIso
    }, { onConflict: "tenant_id,device_id" })
    .select("tenant_id,device_id,platform,app_version,app_flavor,native_generation,ownership_type,enrollment_mode,is_device_owner,is_full_mdm_eligible,capabilities")
    .single<MdmDeviceRow>();

  if (error || !data) throw new Error(error?.message ?? "mdm_device_upsert_failed");
  return data;
}

async function acknowledgeResults(scope: DeviceScope, results: ResultEnvelope[]): Promise<string[]> {
  if (results.length === 0) return [];
  const supabase = getPrimarySupabaseServiceClient();
  const acknowledged: string[] = [];
  const nowIso = new Date().toISOString();

  for (const result of results) {
    const terminalFields = result.status === "succeeded"
      ? { status: "succeeded", completed_at: nowIso, failed_at: null }
      : { status: "failed", completed_at: null, failed_at: nowIso };

    const { data: command, error } = await supabase
      .from("mdm_commands")
      .update({ ...terminalFields, command_result: result.result, updated_at: nowIso })
      .eq("id", result.command_id)
      .eq("tenant_id", scope.tenant_id)
      .eq("device_id", scope.id)
      .in("status", ["picked_up", "running"])
      .select("id,command_type")
      .maybeSingle<{ id: string; command_type: MdmCommandType }>();

    if (error) {
      console.error("[full-mdm] result acknowledgement failed", { command_id: result.command_id, message: error.message });
      continue;
    }
    if (!command) continue;

    acknowledged.push(command.id);
    const { error: auditError } = await supabase.from("mdm_command_audit").insert({
      tenant_id: scope.tenant_id,
      device_id: scope.id,
      command_id: command.id,
      command_type: command.command_type,
      event_type: "device_result",
      decision: result.status === "succeeded" ? "executed" : "failed",
      reason: null,
      metadata: { result: result.result, delivery_surface: "android_full_mdm_heartbeat" }
    });
    if (auditError) console.error("[full-mdm] result audit failed", { command_id: command.id, message: auditError.message });
  }

  return acknowledged;
}

async function rejectCommand(scope: DeviceScope, command: CommandRow, reason: string) {
  const supabase = getPrimarySupabaseServiceClient();
  const nowIso = new Date().toISOString();
  await supabase.from("mdm_commands").update({
    status: "rejected",
    failed_at: nowIso,
    command_result: { code: reason },
    updated_at: nowIso
  }).eq("id", command.id).eq("status", command.status);

  await supabase.from("mdm_command_audit").insert({
    tenant_id: scope.tenant_id,
    device_id: scope.id,
    command_id: command.id,
    command_type: command.command_type,
    event_type: "delivery_revalidation",
    decision: "rejected",
    reason,
    metadata: { delivery_surface: "android_full_mdm_heartbeat" }
  });
}

async function loadDeliverableCommands(scope: DeviceScope, device: MdmDeviceRow): Promise<FullMdmCommandEnvelope[]> {
  const supabase = getPrimarySupabaseServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const retryBeforeIso = new Date(now.getTime() - RETRY_PICKUP_AFTER_MS).toISOString();

  await supabase.from("mdm_commands").update({ status: "expired", updated_at: nowIso })
    .eq("tenant_id", scope.tenant_id)
    .eq("device_id", scope.id)
    .in("status", ["queued", "picked_up"])
    .not("expires_at", "is", null)
    .lte("expires_at", nowIso);

  const select = "id,command_type,reason,payload,status,queued_at,picked_up_at,expires_at";
  const queuedResponse = await supabase.from("mdm_commands")
    .select(select)
    .eq("tenant_id", scope.tenant_id)
    .eq("device_id", scope.id)
    .eq("status", "queued")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("queued_at", { ascending: true })
    .limit(COMMAND_LIMIT)
    .returns<CommandRow[]>();
  if (queuedResponse.error) throw new Error(`mdm_queue_read_failed:${queuedResponse.error.message}`);

  const remaining = Math.max(COMMAND_LIMIT - (queuedResponse.data?.length ?? 0), 0);
  let stale: CommandRow[] = [];
  if (remaining > 0) {
    const staleResponse = await supabase.from("mdm_commands")
      .select(select)
      .eq("tenant_id", scope.tenant_id)
      .eq("device_id", scope.id)
      .eq("status", "picked_up")
      .lt("picked_up_at", retryBeforeIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("picked_up_at", { ascending: true })
      .limit(remaining)
      .returns<CommandRow[]>();
    if (staleResponse.error) throw new Error(`mdm_retry_queue_read_failed:${staleResponse.error.message}`);
    stale = staleResponse.data ?? [];
  }

  const snapshot = {
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    platform: device.platform,
    appVersion: device.app_version,
    appFlavor: device.app_flavor,
    nativeGeneration: device.native_generation,
    ownershipType: device.ownership_type,
    enrollmentMode: device.enrollment_mode,
    isDeviceOwner: device.is_device_owner,
    capabilities: asStringArray(device.capabilities)
  };
  const decision = evaluateMdmEligibility(snapshot);
  const envelopes: FullMdmCommandEnvelope[] = [];

  for (const command of [...(queuedResponse.data ?? []), ...stale].slice(0, COMMAND_LIMIT)) {
    if (!decision.allowedCommands.includes(command.command_type)) {
      await rejectCommand(scope, command, "command_not_allowed_by_current_device_eligibility");
      continue;
    }
    if (!EXECUTOR_COMMANDS.has(command.command_type)) {
      await rejectCommand(scope, command, "agent_executor_not_implemented_for_command");
      continue;
    }

    const { data: picked, error: pickupError } = await supabase.from("mdm_commands")
      .update({ status: "picked_up", picked_up_at: nowIso, updated_at: nowIso })
      .eq("id", command.id)
      .eq("tenant_id", scope.tenant_id)
      .eq("device_id", scope.id)
      .eq("status", command.status)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (pickupError || !picked) continue;

    await supabase.from("mdm_command_audit").insert({
      tenant_id: scope.tenant_id,
      device_id: scope.id,
      command_id: command.id,
      command_type: command.command_type,
      event_type: "picked_up",
      decision: "accepted",
      reason: command.reason,
      metadata: { delivery_surface: "android_full_mdm_heartbeat" }
    });

    envelopes.push({
      id: command.id,
      command_type: command.command_type,
      reason: command.reason,
      payload: asRecord(command.payload),
      expires_at: command.expires_at
    });
  }

  return envelopes;
}

export async function syncFullMdmHeartbeat(input: {
  scope: DeviceScope;
  payload: JsonRecord | null;
  installId: string;
  appVersion: string | null;
}): Promise<FullMdmHeartbeatResult> {
  const fullMdm = asRecord(input.payload?.full_mdm);
  if (Number(fullMdm.schema_version ?? 0) < 1) {
    return { status: "not_advertised", device_id: null, eligible: false, mode: "not_available", reasons: ["full_mdm_capability_not_advertised"], commands: [], acknowledged_result_ids: [] };
  }

  try {
    const enrollment = await loadTrustedEnrollment(input.scope, input.installId);
    if (!enrollment) {
      return { status: "pending_enrollment", device_id: input.scope.id, eligible: false, mode: "diagnostics_only", reasons: ["trusted_device_enrollment_required"], commands: [], acknowledged_result_ids: [] };
    }

    const device = await upsertMdmDevice({ ...input, enrollment });
    const acknowledged = await acknowledgeResults(input.scope, parseResults(input.payload));
    const commands = await loadDeliverableCommands(input.scope, device);
    const decision = evaluateMdmEligibility({
      tenantId: device.tenant_id,
      deviceId: device.device_id,
      platform: device.platform,
      appVersion: device.app_version,
      appFlavor: device.app_flavor,
      nativeGeneration: device.native_generation,
      ownershipType: device.ownership_type,
      enrollmentMode: device.enrollment_mode,
      isDeviceOwner: device.is_device_owner,
      capabilities: asStringArray(device.capabilities)
    });

    return {
      status: "active",
      device_id: input.scope.id,
      eligible: decision.isEligible,
      mode: decision.mode,
      reasons: decision.reasons,
      commands,
      acknowledged_result_ids: acknowledged
    };
  } catch (error) {
    console.error("[full-mdm] heartbeat sync failed", {
      device_code: input.scope.device_code,
      message: error instanceof Error ? error.message : "unknown"
    });
    return { status: "unavailable", device_id: input.scope.id, eligible: false, mode: "not_available", reasons: ["full_mdm_transport_unavailable"], commands: [], acknowledged_result_ids: [] };
  }
}
