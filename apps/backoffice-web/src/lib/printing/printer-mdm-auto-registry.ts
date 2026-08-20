import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const AUTO_SOURCE = "android_mdm_auto_registry_v1";
const PROTECTED_TENANT_CODES = new Set(["FG0003", "FG00003"]);
const MAX_AUTO_VERIFICATION_ATTEMPTS = 3;
const AUTO_VERIFICATION_RETRY_AFTER_MS = 90_000;
const AUTO_VERIFICATION_WINDOW_MS = 5 * 60_000;

type JsonRecord = Record<string, unknown>;

type PairedDeviceScope = {
  id: string;
  tenantId: string;
  branchId: string;
  deviceCode: string;
};

type AutoCandidate = {
  fingerprint: string;
  mode: "usb" | "bluetooth";
  displayName: string;
  brand: string | null;
  model: string | null;
  paperWidthMm: 58 | 80;
  status: "online" | "needs_check";
  verificationSupportedNow: boolean;
  capabilities: JsonRecord;
  observation: JsonRecord;
};

type PrinterDeviceRow = {
  id: string;
  printer_profile_id: string | null;
  display_name: string;
  connection_mode: string;
  paper_width_mm: number;
  device_fingerprint: string | null;
  runtime_device_code: string | null;
  status: string;
  capabilities: JsonRecord | null;
  last_seen_at: string | null;
  is_active: boolean;
  metadata: JsonRecord | null;
};

export type ModernPrinterAutoCommand = {
  id: string;
  action: "test_printer_verification";
  reason: "printer_auto_first_verification";
  printer_verification: {
    mode: "verification_print";
    target_fingerprint: string;
    issued_at_ms: number;
    expires_at_ms: number;
    operator_confirmed: true;
  };
};

export type ModernPrinterAutoReconcileResult = {
  eligible: boolean;
  candidateCount: number;
  commands: ModernPrinterAutoCommand[];
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function inferPaperWidth(...values: unknown[]): 58 | 80 {
  const joined = values.map((value) => text(value) ?? "").join(" ").toLowerCase();
  if (/(^|\D)58(\D|$)/.test(joined)) return 58;
  return 80;
}

function modernPrinterAutoEligible(payload: JsonRecord | null): boolean {
  const capabilities = asRecord(payload?.runtime_capabilities);
  const printer = asRecord(capabilities.printer);
  const updates = asRecord(capabilities.updates);
  const schemaVersion = Number(capabilities.schema_version ?? 0);

  return schemaVersion >= 3 &&
    String(updates.channel ?? "").trim().toLowerCase() === "modern" &&
    updates.silent_install === false &&
    updates.forced_update === false &&
    printer.target_probe === true &&
    printer.one_time_verification_print === true &&
    printer.explicit_assignment_first === true &&
    printer.automatic_reassignment === false &&
    String(printer.assignment_protection ?? "") === "preserve_existing_or_require_confirmation";
}

function extractUsbCandidates(inventory: JsonRecord): AutoCandidate[] {
  const usb = asRecord(inventory.usb);
  const rows = asArray(usb.devices);
  const candidates: AutoCandidate[] = [];

  for (const value of rows) {
    const row = asRecord(value);
    const fingerprint = text(row.physical_fingerprint)?.toLowerCase() ?? null;
    if (!fingerprint?.startsWith("usb:")) continue;
    if (String(row.physical_fingerprint_stability ?? "") !== "stable") continue;
    if (!bool(row.safe_autobind_candidate) || !bool(row.native_transport_candidate)) continue;

    const productName = text(row.product_name);
    const manufacturerName = text(row.manufacturer_name);
    const hasPermission = bool(row.has_permission);
    candidates.push({
      fingerprint,
      mode: "usb",
      displayName: productName ?? `USB Printer ${String(row.vendor_id ?? "")}:${String(row.product_id ?? "")}`,
      brand: manufacturerName,
      model: productName,
      paperWidthMm: inferPaperWidth(productName, manufacturerName),
      status: hasPermission ? "online" : "needs_check",
      // The 1.0.17 verification transport may request exact USB permission when needed.
      verificationSupportedNow: true,
      capabilities: {
        auto_discovered: true,
        stable_fingerprint: true,
        native_transport_candidate: true,
        safe_autobind_candidate: true,
        permission_granted: hasPermission
      },
      observation: {
        vendor_id: row.vendor_id ?? null,
        product_id: row.product_id ?? null,
        serial_number: text(row.serial_number),
        device_name: text(row.device_name),
        product_name: productName,
        manufacturer_name: manufacturerName,
        has_permission: hasPermission
      }
    });
  }

  return candidates;
}

function extractBluetoothCandidates(inventory: JsonRecord): AutoCandidate[] {
  const bluetooth = asRecord(inventory.bluetooth);
  if (!bool(bluetooth.supported)) return [];
  const connectPermission = bool(bluetooth.connect_permission_granted);
  const enabled = bool(bluetooth.enabled);
  const rows = asArray(bluetooth.bonded_devices);
  const candidates: AutoCandidate[] = [];

  for (const value of rows) {
    const row = asRecord(value);
    const fingerprint = text(row.physical_fingerprint)?.toLowerCase() ?? null;
    if (!fingerprint?.startsWith("bluetooth:mac:")) continue;
    if (String(row.physical_fingerprint_stability ?? "") !== "stable") continue;
    // A paired audio/SPP device must never be treated as a printer merely because SPP exists.
    if (!bool(row.printer_name_hint)) continue;

    const name = text(row.name) ?? "Bluetooth Printer";
    const sppAdvertised = bool(row.spp_uuid_present);
    candidates.push({
      fingerprint,
      mode: "bluetooth",
      displayName: name,
      brand: null,
      model: name,
      paperWidthMm: inferPaperWidth(name),
      status: connectPermission && enabled ? "online" : "needs_check",
      // 1.0.17's verification service still requires advertised SPP. Keep the printer visible
      // but do not generate an automatic print until a runtime that can safely probe exact MAC
      // without using advertised UUID presence as a hard requirement is installed.
      verificationSupportedNow: connectPermission && enabled && sppAdvertised,
      capabilities: {
        auto_discovered: true,
        stable_fingerprint: true,
        bonded: true,
        connect_permission_granted: connectPermission,
        bluetooth_enabled: enabled,
        printer_name_hint: true,
        spp_uuid_advertised: sppAdvertised
      },
      observation: {
        name,
        address: text(row.address),
        bond_state: row.bond_state ?? null,
        device_type: row.device_type ?? null,
        device_class: row.device_class ?? null,
        spp_uuid_present: sppAdvertised
      }
    });
  }

  return candidates;
}

function extractCandidates(payload: JsonRecord | null): AutoCandidate[] {
  const printer = asRecord(payload?.printer);
  const inventory = asRecord(printer.inventory);
  const byFingerprint = new Map<string, AutoCandidate>();
  for (const candidate of [...extractUsbCandidates(inventory), ...extractBluetoothCandidates(inventory)]) {
    byFingerprint.set(candidate.fingerprint, candidate);
  }
  return Array.from(byFingerprint.values());
}

function verificationState(metadata: JsonRecord): JsonRecord {
  return asRecord(metadata.auto_verification);
}

function initialVerification(candidate: AutoCandidate): JsonRecord {
  return candidate.verificationSupportedNow
    ? { state: "pending", attempts: 0, last_code: null }
    : { state: "runtime_upgrade_required", attempts: 0, last_code: "verification_transport_not_ready" };
}

function shouldRetryVerification(state: JsonRecord, nowMs: number): boolean {
  const status = String(state.state ?? "");
  const attempts = Number(state.attempts ?? 0);
  if (attempts >= MAX_AUTO_VERIFICATION_ATTEMPTS) return false;
  if (status === "pending") return true;
  if (status !== "in_flight") return false;
  const sentAtMs = Date.parse(String(state.last_sent_at ?? ""));
  return !Number.isFinite(sentAtMs) || nowMs - sentAtMs >= AUTO_VERIFICATION_RETRY_AFTER_MS;
}

function commandIdForPrinterDevice(id: string): string {
  return `auto-printer:${id}`;
}

async function isProtectedTenant(tenantId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("tenants").select("code").eq("id", tenantId).maybeSingle<{ code: string | null }>();
  if (error || !data?.code) return true;
  return PROTECTED_TENANT_CODES.has(data.code.trim().toUpperCase());
}

async function appendDiscoveryHistory(scope: PairedDeviceScope, device: PrinterDeviceRow, candidate: AutoCandidate) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("printer_device_history").insert({
    tenant_id: scope.tenantId,
    branch_id: scope.branchId,
    printer_device_id: device.id,
    printer_profile_id: device.printer_profile_id,
    event_type: "discovered",
    device_name: candidate.displayName,
    brand: candidate.brand,
    model: candidate.model,
    connection_mode: candidate.mode,
    paper_width_mm: candidate.paperWidthMm,
    details: {
      source: AUTO_SOURCE,
      physical_fingerprint: candidate.fingerprint,
      runtime_device_code: scope.deviceCode
    },
    created_by: null
  });
  if (error) console.error("[printer-auto-registry] history insert failed", { message: error.message });
}

async function acknowledgeAutoVerification(scope: PairedDeviceScope, payload: JsonRecord | null) {
  const lastCommand = asRecord(payload?.last_command);
  if (String(lastCommand.action ?? "").trim().toLowerCase() !== "test_printer_verification") return;
  const commandId = text(lastCommand.command_id);
  if (!commandId?.startsWith("auto-printer:")) return;
  const printerDeviceId = commandId.slice("auto-printer:".length);
  if (!/^[0-9a-f-]{36}$/i.test(printerDeviceId)) return;

  const supabase = getSupabaseServiceClient();
  const { data: device, error } = await supabase
    .from("printer_devices")
    .select("id,printer_profile_id,display_name,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,is_active,metadata")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("id", printerDeviceId)
    .maybeSingle<PrinterDeviceRow>();
  if (error || !device || device.runtime_device_code !== scope.deviceCode || !device.is_active) return;

  const result = asRecord(lastCommand.result);
  const previousMetadata = asRecord(device.metadata);
  const previousVerification = verificationState(previousMetadata);
  const ok = result.ok === true && result.printed === true && result.consumed === true;
  const alreadyConsumed = result.consumed === true && String(result.code ?? "") === "verification_command_already_consumed";
  const verified = ok || alreadyConsumed;
  const retryable = result.retryable === true;
  const attempts = Number(previousVerification.attempts ?? 0);
  const nextState = verified
    ? "verified"
    : retryable && attempts < MAX_AUTO_VERIFICATION_ATTEMPTS
      ? "pending"
      : "needs_check";
  const now = new Date().toISOString();
  const nextMetadata = {
    ...previousMetadata,
    auto_verification: {
      ...previousVerification,
      state: nextState,
      command_id: commandId,
      last_code: text(result.code),
      last_result: result,
      acknowledged_at: now,
      verified_at: verified ? now : previousVerification.verified_at ?? null
    }
  };

  const { error: updateError } = await supabase.from("printer_devices").update({
    status: verified ? "online" : device.status,
    metadata: nextMetadata,
    updated_at: now
  }).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId).eq("id", device.id);
  if (updateError) console.error("[printer-auto-registry] verification ack failed", { message: updateError.message });
}

async function reconcileCandidates(scope: PairedDeviceScope, candidates: AutoCandidate[]): Promise<PrinterDeviceRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data: runtimeRows, error: loadError } = await supabase
    .from("printer_devices")
    .select("id,printer_profile_id,display_name,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,is_active,metadata")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("runtime_device_code", scope.deviceCode)
    .returns<PrinterDeviceRow[]>();
  if (loadError) {
    console.error("[printer-auto-registry] device load failed", { message: loadError.message });
    return [];
  }

  const existingByFingerprint = new Map((runtimeRows ?? []).filter((row) => row.device_fingerprint).map((row) => [String(row.device_fingerprint).toLowerCase(), row]));
  const observed = new Set(candidates.map((candidate) => candidate.fingerprint));
  const reconciled: PrinterDeviceRow[] = [];
  const now = new Date().toISOString();

  for (const candidate of candidates) {
    const existing = existingByFingerprint.get(candidate.fingerprint);
    if (existing && !existing.is_active) {
      // A user explicitly disconnected/deleted this physical printer. Discovery must not
      // silently reactivate it. Reconnection remains a user-owned action.
      continue;
    }

    const previousMetadata = asRecord(existing?.metadata);
    const autoVerification = Object.keys(verificationState(previousMetadata)).length > 0
      ? verificationState(previousMetadata)
      : initialVerification(candidate);
    const metadata = {
      ...previousMetadata,
      source: previousMetadata.source ?? AUTO_SOURCE,
      auto_discovered: previousMetadata.auto_discovered ?? true,
      physical_fingerprint: candidate.fingerprint,
      observed_runtime_device_code: scope.deviceCode,
      last_observation: candidate.observation,
      auto_verification: autoVerification
    };
    const capabilities = { ...asRecord(existing?.capabilities), ...candidate.capabilities };

    if (existing) {
      const { data: updated, error } = await supabase.from("printer_devices").update({
        display_name: existing.printer_profile_id ? existing.display_name : candidate.displayName,
        connection_mode: candidate.mode,
        paper_width_mm: existing.printer_profile_id ? existing.paper_width_mm : candidate.paperWidthMm,
        status: candidate.status,
        capabilities,
        last_seen_at: now,
        metadata,
        updated_at: now
      }).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId).eq("id", existing.id)
        .select("id,printer_profile_id,display_name,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,is_active,metadata")
        .single<PrinterDeviceRow>();
      if (!error && updated) reconciled.push(updated);
      else if (error) console.error("[printer-auto-registry] device refresh failed", { message: error.message });
      continue;
    }

    const { data: inserted, error } = await supabase.from("printer_devices").insert({
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      display_name: candidate.displayName,
      brand: candidate.brand,
      model: candidate.model,
      connection_mode: candidate.mode,
      paper_width_mm: candidate.paperWidthMm,
      device_fingerprint: candidate.fingerprint,
      runtime_device_code: scope.deviceCode,
      status: candidate.status,
      capabilities,
      last_seen_at: now,
      is_active: true,
      metadata,
      created_by: null,
      updated_at: now
    }).select("id,printer_profile_id,display_name,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,is_active,metadata")
      .single<PrinterDeviceRow>();

    if (error) {
      // Concurrent heartbeat may win the unique fingerprint insert. Do not manufacture a
      // second identity and do not broaden the matching key.
      if (error.code !== "23505") console.error("[printer-auto-registry] device insert failed", { message: error.message });
      continue;
    }
    if (inserted) {
      reconciled.push(inserted);
      await appendDiscoveryHistory(scope, inserted, candidate);
    }
  }

  const missingAutoRows = (runtimeRows ?? []).filter((row) => {
    const metadata = asRecord(row.metadata);
    return row.is_active && metadata.source === AUTO_SOURCE && row.device_fingerprint && !observed.has(String(row.device_fingerprint).toLowerCase());
  });
  if (missingAutoRows.length > 0) {
    await supabase.from("printer_devices").update({ status: "offline", updated_at: now })
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .in("id", missingAutoRows.map((row) => row.id));
  }

  return reconciled;
}

async function buildNextVerificationCommand(scope: PairedDeviceScope, rows: PrinterDeviceRow[], candidates: AutoCandidate[]): Promise<ModernPrinterAutoCommand[]> {
  const candidateByFingerprint = new Map(candidates.map((candidate) => [candidate.fingerprint, candidate]));
  const nowMs = Date.now();
  const target = rows.find((row) => {
    if (!row.is_active || row.printer_profile_id) return false;
    const fingerprint = text(row.device_fingerprint)?.toLowerCase() ?? null;
    if (!fingerprint) return false;
    const candidate = candidateByFingerprint.get(fingerprint);
    if (!candidate?.verificationSupportedNow) return false;
    return shouldRetryVerification(verificationState(asRecord(row.metadata)), nowMs);
  });
  if (!target?.device_fingerprint) return [];

  const candidate = candidateByFingerprint.get(target.device_fingerprint.toLowerCase());
  if (!candidate) return [];
  const previousMetadata = asRecord(target.metadata);
  const previousVerification = verificationState(previousMetadata);
  const attempts = Number(previousVerification.attempts ?? 0) + 1;
  const commandId = commandIdForPrinterDevice(target.id);
  const issuedAt = new Date(nowMs).toISOString();
  const nextMetadata = {
    ...previousMetadata,
    auto_verification: {
      ...previousVerification,
      state: "in_flight",
      attempts,
      command_id: commandId,
      last_sent_at: issuedAt,
      confirmation_source: "product_auto_setup_policy"
    }
  };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("printer_devices").update({ metadata: nextMetadata, updated_at: issuedAt })
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("id", target.id)
    .is("printer_profile_id", null)
    .eq("is_active", true);
  if (error) {
    console.error("[printer-auto-registry] verification schedule failed", { message: error.message });
    return [];
  }

  return [{
    id: commandId,
    action: "test_printer_verification",
    reason: "printer_auto_first_verification",
    printer_verification: {
      mode: "verification_print",
      target_fingerprint: candidate.fingerprint,
      issued_at_ms: nowMs,
      expires_at_ms: nowMs + AUTO_VERIFICATION_WINDOW_MS,
      operator_confirmed: true
    }
  }];
}

export async function reconcileModernPrinterInventory(input: {
  device: PairedDeviceScope;
  payload: JsonRecord | null;
}): Promise<ModernPrinterAutoReconcileResult> {
  if (!modernPrinterAutoEligible(input.payload)) {
    return { eligible: false, candidateCount: 0, commands: [] };
  }
  if (await isProtectedTenant(input.device.tenantId)) {
    return { eligible: false, candidateCount: 0, commands: [] };
  }

  await acknowledgeAutoVerification(input.device, input.payload);
  const candidates = extractCandidates(input.payload);
  const rows = await reconcileCandidates(input.device, candidates);
  const commands = await buildNextVerificationCommand(input.device, rows, candidates);
  return { eligible: true, candidateCount: candidates.length, commands };
}

export const printerMdmAutoRegistryTestables = {
  modernPrinterAutoEligible,
  extractCandidates,
  inferPaperWidth
};
