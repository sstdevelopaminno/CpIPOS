import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const SAFE_MDM_COMMANDS = new Set([
  "ping",
  "collect_diagnostics",
  "reload_webview",
  "navigate_home",
  "clear_webview_cache",
  "clear_cookies",
  "clear_webview_data",
  "test_printer_connection",
  "test_printer_verification"
]);

const MDM_RELOAD_GENERATION_MS = 1786478151547;
const PRINTER_VERIFICATION_RETRY_DELAY_MS = 5_000;
const PRINTER_VERIFICATION_MAX_RETRIES = 3;
const PRINTER_PROBE_MAX_WINDOW_MS = 30 * 60_000;
const PRINTER_VERIFICATION_PRINT_MAX_WINDOW_MS = 5 * 60_000;

type PrinterVerificationEnvelope = {
  mode: "probe" | "verification_print";
  target_fingerprint: string;
  issued_at_ms: number;
  expires_at_ms: number;
  operator_confirmed: boolean;
};
type PrinterVerificationBuild = {
  requested: boolean;
  envelope: PrinterVerificationEnvelope | null;
  error: string | null;
};
type AndroidPosMdmCommand = {
  id?: string;
  action?: string;
  reason?: string;
  printer_verification?: PrinterVerificationEnvelope;
};
type PairedDevice = { id: string; device_code: string; metadata: Record<string, unknown> | null };
type PendingPrinterCommand = {
  id: string;
  issued_at: string;
  expires_at: string;
  metadata: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
};
type DeliveredPrinterCommand = {
  id: string;
  expires_at: string;
  result: Record<string, unknown> | null;
};
type PendingUiCommand = { id: string; command_type: "reload_ui" | "refresh_config"; issued_at: string; metadata: Record<string, unknown> | null };

function noStoreHeaders() {
  return { "Cache-Control": "no-store, no-cache, must-revalidate", "X-CpIPOS-MDM-Lite": "android-pos" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseSafeCommandsFromEnv(): AndroidPosMdmCommand[] {
  const raw = process.env.CPIPOS_ANDROID_POS_MDM_COMMANDS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value): AndroidPosMdmCommand | null => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const action = String(row.action ?? "").trim().toLowerCase();
      if (!SAFE_MDM_COMMANDS.has(action) || action === "test_printer_verification") return null;
      return { id: String(row.id ?? `env-${action}`).slice(0, 80), action, reason: String(row.reason ?? "env_control").slice(0, 160) };
    }).filter((value): value is AndroidPosMdmCommand => Boolean(value)).slice(0, 5);
  } catch {
    return [];
  }
}

function getLastReloadAtMs(payload: Record<string, unknown> | null): number {
  const lastCommand = asRecord(payload?.last_command);
  if (String(lastCommand.action ?? "").trim().toLowerCase() !== "reload_webview") return 0;
  const atMs = Number(lastCommand.at_ms ?? 0);
  return Number.isFinite(atMs) && atMs > 0 ? atMs : 0;
}

function buildHeartbeatCommands(payload: Record<string, unknown> | null): AndroidPosMdmCommand[] {
  const envCommands = parseSafeCommandsFromEnv().filter((command) => command.action !== "reload_webview");
  if (getLastReloadAtMs(payload) >= MDM_RELOAD_GENERATION_MS) return envCommands.slice(0, 5);
  return [...envCommands, { id: `deploy-reload-${MDM_RELOAD_GENERATION_MS}`, action: "reload_webview", reason: "post_deploy_refresh" }].slice(0, 5);
}

function resolvePersistedPrinterState(metadata: Record<string, unknown>, payload: Record<string, unknown> | null) {
  const nativePrinter = asRecord(payload?.printer);
  const existingPrinter = asRecord(metadata.android_mdm_printer);
  const nativeError = String(nativePrinter.last_error ?? "").trim().toLowerCase();
  const existingSource = String(existingPrinter.source ?? "").trim().toLowerCase();
  const hasVerifiedPrintAgentState = existingPrinter.verified === true && existingSource === "native_print_agent_verified";

  if (hasVerifiedPrintAgentState && nativeError === "printer_not_configured") {
    return {
      ...existingPrinter,
      mdm_local_diagnostic: {
        ...nativePrinter,
        ignored_for_status: true,
        observed_at: new Date().toISOString()
      }
    };
  }

  return nativePrinter;
}

function resolvePersistedRuntimeCapabilities(metadata: Record<string, unknown>, payload: Record<string, unknown> | null) {
  const incomingCapabilities = asRecord(payload?.runtime_capabilities);
  if (Object.keys(incomingCapabilities).length > 0) return incomingCapabilities;
  return asRecord(metadata.android_mdm_runtime_capabilities);
}

function buildPrinterVerificationEnvelope(row: PendingPrinterCommand): PrinterVerificationBuild {
  const metadata = asRecord(row.metadata);
  const nested = asRecord(metadata.printer_verification);
  const source = Object.keys(nested).length > 0 ? nested : metadata;
  const modeRaw = String(source.mode ?? "").trim().toLowerCase();
  const requested = Object.keys(nested).length > 0 || modeRaw === "probe" || modeRaw === "verification_print";
  if (!requested) return { requested: false, envelope: null, error: null };
  if (modeRaw !== "probe" && modeRaw !== "verification_print") {
    return { requested: true, envelope: null, error: "verification_mode_invalid" };
  }

  const targetFingerprint = String(source.target_fingerprint ?? source.device_fingerprint ?? "").trim().toLowerCase();
  if (!targetFingerprint || targetFingerprint.length > 240) {
    return { requested: true, envelope: null, error: "verification_target_invalid" };
  }

  const issuedAtMs = Date.parse(row.issued_at);
  const databaseExpiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(databaseExpiresAtMs)) {
    return { requested: true, envelope: null, error: "verification_window_invalid" };
  }
  const maxWindowMs = modeRaw === "verification_print"
    ? PRINTER_VERIFICATION_PRINT_MAX_WINDOW_MS
    : PRINTER_PROBE_MAX_WINDOW_MS;

  return {
    requested: true,
    envelope: {
      mode: modeRaw,
      target_fingerprint: targetFingerprint,
      issued_at_ms: issuedAtMs,
      expires_at_ms: Math.min(databaseExpiresAtMs, issuedAtMs + maxWindowMs),
      operator_confirmed: source.operator_confirmed === true
    },
    error: null
  };
}

function printerCommandRetryReady(row: PendingPrinterCommand, nowMs: number): boolean {
  const retryAfter = String(asRecord(row.result).retry_after_at ?? "").trim();
  if (!retryAfter) return true;
  const retryAfterMs = Date.parse(retryAfter);
  return !Number.isFinite(retryAfterMs) || retryAfterMs <= nowMs;
}

async function findPairedDevice(installId: string | null): Promise<PairedDevice | null> {
  if (!installId) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_devices")
    .select("id,device_code,metadata")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .order("updated_at", { ascending: false })
    .limit(2)
    .returns<PairedDevice[]>();
  if (error) {
    console.error("[android-pos-mdm] paired device lookup failed", { message: error.message });
    return null;
  }

  const rows = data ?? [];
  if (rows.length > 1) {
    console.error("[android-pos-mdm] duplicate install id binding blocked", {
      install_id_suffix: installId.slice(-8),
      matched_device_codes: rows.map((row) => row.device_code)
    });
    return null;
  }
  return rows[0] ?? null;
}

async function acknowledgePreviousPrinterTest(device: PairedDevice, payload: Record<string, unknown> | null, appVersion: string | null) {
  const lastCommand = asRecord(payload?.last_command);
  const action = String(lastCommand.action ?? "").trim().toLowerCase();
  if (action !== "test_printer_connection" && action !== "test_printer_verification") return;

  const commandId = String(lastCommand.command_id ?? "").trim();
  const commandResult = asRecord(lastCommand.result);
  const printer = asRecord(payload?.printer);
  const supabase = getSupabaseServiceClient();

  let row: DeliveredPrinterCommand | null = null;
  if (action === "test_printer_verification") {
    if (!/^[0-9a-f-]{36}$/i.test(commandId)) return;
    const response = await supabase
      .from("device_commands")
      .select("id,expires_at,result")
      .eq("id", commandId)
      .eq("pos_device_id", device.id)
      .eq("command_type", "test_printer")
      .eq("status", "delivered")
      .maybeSingle<DeliveredPrinterCommand>();
    row = response.data ?? null;
  } else {
    const response = await supabase
      .from("device_commands")
      .select("id,expires_at,result")
      .eq("pos_device_id", device.id)
      .eq("command_type", "test_printer")
      .eq("status", "delivered")
      .order("delivered_at", { ascending: false })
      .limit(1)
      .maybeSingle<DeliveredPrinterCommand>();
    row = response.data ?? null;
  }
  if (!row) return;

  const applied = action === "test_printer_connection" ? true : commandResult.ok === true;
  const retryable = action === "test_printer_verification" && !applied && commandResult.retryable === true;
  const previousResult = asRecord(row.result);
  const retryCount = Number(previousResult.retry_count ?? 0);
  const expiresAtMs = Date.parse(row.expires_at);
  const mayRetry = retryable &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > Date.now() + PRINTER_VERIFICATION_RETRY_DELAY_MS &&
    retryCount < PRINTER_VERIFICATION_MAX_RETRIES;
  const result = {
    applied,
    mdm_action: action,
    app_version: appVersion,
    printer,
    verification: commandResult,
    retry_count: mayRetry ? retryCount + 1 : retryCount,
    retry_after_at: mayRetry ? new Date(Date.now() + PRINTER_VERIFICATION_RETRY_DELAY_MS).toISOString() : null,
    acknowledged_at: new Date().toISOString()
  };

  if (mayRetry) {
    await supabase.from("device_commands").update({
      status: "pending",
      delivered_at: null,
      result
    }).eq("id", row.id);
    return;
  }

  await supabase.from("device_commands").update({ result }).eq("id", row.id);
}

async function acknowledgePreviousUiReload(device: PairedDevice, payload: Record<string, unknown> | null, appVersion: string | null) {
  const lastCommand = asRecord(payload?.last_command);
  if (String(lastCommand.action ?? "").trim().toLowerCase() !== "reload_webview") return;
  const atMs = Number(lastCommand.at_ms ?? 0);
  if (!Number.isFinite(atMs) || atMs <= 0) return;

  const supabase = getSupabaseServiceClient();
  const executedAt = new Date(atMs).toISOString();
  const lowerBound = new Date(atMs - 5 * 60 * 1000).toISOString();
  await supabase.from("device_commands").update({
    result: {
      applied: true,
      phase: "executed",
      mdm_action: "reload_webview",
      app_version: appVersion,
      acknowledged_at: new Date().toISOString(),
      executed_at: executedAt
    }
  })
    .eq("pos_device_id", device.id)
    .in("command_type", ["reload_ui", "refresh_config"])
    .eq("status", "delivered")
    .gte("delivered_at", lowerBound)
    .lte("delivered_at", executedAt);
}

async function persistNativeMdmState(device: PairedDevice, payload: Record<string, unknown> | null, appVersion: string | null) {
  const supabase = getSupabaseServiceClient();
  const metadata = asRecord(device.metadata);
  await supabase.from("branch_devices").update({
    last_seen_at: new Date().toISOString(),
    metadata: {
      ...metadata,
      android_mdm_last_seen_at: new Date().toISOString(),
      android_mdm_app_version: appVersion,
      android_mdm_printer: resolvePersistedPrinterState(metadata, payload),
      android_mdm_last_command: asRecord(payload?.last_command),
      android_mdm_runtime: asRecord(payload?.app),
      android_mdm_runtime_capabilities: resolvePersistedRuntimeCapabilities(metadata, payload),
      android_mdm_displays: asRecord(payload?.displays)
    },
    updated_at: new Date().toISOString()
  }).eq("id", device.id);
}

async function deliverUiReloadCommands(device: PairedDevice): Promise<AndroidPosMdmCommand[]> {
  const supabase = getSupabaseServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();

  await supabase.from("device_commands").update({ status: "expired" })
    .eq("pos_device_id", device.id)
    .in("command_type", ["reload_ui", "refresh_config"])
    .eq("status", "pending")
    .lte("expires_at", nowIso);

  const { data: rows, error } = await supabase.from("device_commands")
    .select("id,command_type,issued_at,metadata")
    .eq("pos_device_id", device.id)
    .in("command_type", ["reload_ui", "refresh_config"])
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("issued_at", { ascending: true })
    .limit(4)
    .returns<PendingUiCommand[]>();
  if (error || !rows?.length) return [];

  const ids = rows.map((row) => row.id);
  await supabase.from("device_commands").update({
    status: "delivered",
    delivered_at: nowIso,
    result: {
      applied: false,
      phase: "delivered",
      mdm_action: "reload_webview",
      delivery_surface: "android_pos_mdm_heartbeat"
    }
  }).in("id", ids);

  const reason = rows
    .map((row) => String(asRecord(row.metadata).reason ?? "").trim())
    .find(Boolean) ?? "onsite_ui_refresh";
  return [{ id: rows[0].id, action: "reload_webview", reason: reason.slice(0, 160) }];
}

async function deliverPrinterTestCommands(device: PairedDevice): Promise<AndroidPosMdmCommand[]> {
  const supabase = getSupabaseServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  await supabase.from("device_commands").update({ status: "expired" })
    .eq("pos_device_id", device.id).eq("command_type", "test_printer").eq("status", "pending").lte("expires_at", nowIso);
  const { data: rows, error } = await supabase.from("device_commands")
    .select("id,issued_at,expires_at,metadata,result")
    .eq("pos_device_id", device.id)
    .eq("command_type", "test_printer")
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("issued_at", { ascending: true })
    .limit(3)
    .returns<PendingPrinterCommand[]>();
  if (error || !rows?.length) return [];

  const row = rows.find((candidate) => printerCommandRetryReady(candidate, now.getTime()));
  if (!row) return [];
  const verification = buildPrinterVerificationEnvelope(row);

  if (verification.requested && (!verification.envelope || verification.error)) {
    await supabase.from("device_commands").update({
      status: "delivered",
      delivered_at: nowIso,
      result: {
        applied: false,
        phase: "rejected",
        mdm_action: "test_printer_verification",
        code: verification.error ?? "verification_envelope_invalid",
        delivery_surface: "android_pos_mdm_heartbeat",
        acknowledged_at: nowIso
      }
    }).eq("id", row.id);
    return [];
  }

  await supabase.from("device_commands").update({ status: "delivered", delivered_at: nowIso }).eq("id", row.id);
  if (!verification.envelope) {
    return [{ id: row.id, action: "test_printer_connection", reason: "printer_settings_mdm" }];
  }
  return [{
    id: row.id,
    action: "test_printer_verification",
    reason: verification.envelope.mode === "probe" ? "printer_target_probe" : "printer_one_time_verification",
    printer_verification: verification.envelope
  }];
}

export async function GET() {
  return NextResponse.json({ data: { ok: true, service: "android-pos-mdm-lite-heartbeat", safe_commands: Array.from(SAFE_MDM_COMMANDS), reload_generation_ms: MDM_RELOAD_GENERATION_MS, commands: [] }, error: null }, { headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  const installId = String(request.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120) || null;
  const appVersion = String(request.headers.get("x-cpipos-app-version") ?? "").trim().slice(0, 40) || null;
  const isAndroidPos = request.headers.get("x-cpipos-android-pos") === "true";
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let commands = isAndroidPos ? buildHeartbeatCommands(payload) : [];
  let pairedDeviceCode: string | null = null;

  if (isAndroidPos) {
    const device = await findPairedDevice(installId);
    if (device) {
      pairedDeviceCode = device.device_code;
      await acknowledgePreviousPrinterTest(device, payload, appVersion);
      await acknowledgePreviousUiReload(device, payload, appVersion);
      await persistNativeMdmState(device, payload, appVersion);
      commands = [...commands, ...(await deliverUiReloadCommands(device)), ...(await deliverPrinterTestCommands(device))].slice(0, 5);
    }
  }

  if (commands.some((command) => command.action === "reload_webview")) {
    console.info("[android-pos-mdm] reload issued", { install_id_suffix: installId?.slice(-8) ?? null, app_version: appVersion, generation_ms: MDM_RELOAD_GENERATION_MS, paired_device_code: pairedDeviceCode });
  }

  return NextResponse.json({
    data: {
      ok: true,
      accepted_at: new Date().toISOString(),
      service: "android-pos-mdm-lite-heartbeat",
      install_id: installId,
      app_version: appVersion,
      paired_device_code: pairedDeviceCode,
      payload_received: Boolean(payload),
      reload_generation_ms: MDM_RELOAD_GENERATION_MS,
      commands
    },
    error: null
  }, { headers: noStoreHeaders() });
}
