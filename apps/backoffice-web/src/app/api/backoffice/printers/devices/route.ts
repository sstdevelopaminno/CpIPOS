import type { PrinterConnectionType } from "@pos/shared-types";
import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { getPrinterSettingsAuthContext } from "@/lib/printing/printer-settings-auth";
import { createPrinterProfile, deletePrinterProfile, updatePrinterProfile } from "@/lib/printing/print-service";
import {
  disconnectPrinterDevice,
  getPrinterSettingsRegistry,
  markPrinterDeviceDeleted,
  reconnectPrinterDevice,
  syncPrinterDevice,
  type CustomerConnectionMode,
  type PrinterAssignmentInput,
  type PrinterPurpose
} from "@/lib/printing/printer-device-registry";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type Payload = {
  printer_id?: string | null;
  printer_name?: string | null;
  brand?: string | null;
  model?: string | null;
  connection_mode?: CustomerConnectionMode | null;
  paper_width_mm?: 58 | 80 | null;
  purposes?: PrinterPurpose[] | null;
  assignments?: Array<{
    purpose?: PrinterPurpose | null;
    zone_key?: string | null;
    is_default?: boolean | null;
    copies?: number | null;
  }> | null;
  ip_address?: string | null;
  port?: number | null;
  runtime_device_code?: string | null;
  device_fingerprint?: string | null;
  enabled?: boolean;
  action?: "disconnect" | "reconnect" | null;
  metadata?: Record<string, unknown> | null;
};

type DiscoveredPhysicalRow = {
  id: string;
  display_name: string;
  brand: string | null;
  model: string | null;
  connection_mode: CustomerConnectionMode;
  paper_width_mm: 58 | 80;
  device_fingerprint: string | null;
  runtime_device_code: string | null;
  status: string;
  capabilities: Record<string, unknown> | null;
  last_seen_at: string | null;
  disconnected_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type CreatePhysicalTarget = {
  fingerprint: string;
  discoveredDeviceId: string | null;
  discoveredMetadata: Record<string, unknown>;
};

const PURPOSES = new Set<PrinterPurpose>(["receipt","kitchen","drink","bar","reprint","shift_report","payment_slip","cash_drawer"]);
const ZONED_PURPOSES = new Set<PrinterPurpose>(["kitchen", "drink", "bar"]);

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizePurposes(values: unknown): PrinterPurpose[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is PrinterPurpose => typeof value === "string" && PURPOSES.has(value as PrinterPurpose))));
}

function normalizeAssignments(body: Payload): PrinterAssignmentInput[] {
  if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
    return normalizePurposes(body.purposes).map((purpose) => ({ purpose, zoneKey: "", isDefault: false, copies: 1 }));
  }
  const byKey = new Map<string, PrinterAssignmentInput>();
  for (const raw of body.assignments) {
    const purpose = raw?.purpose;
    if (!purpose || !PURPOSES.has(purpose)) continue;
    const zoneKey = ZONED_PURPOSES.has(purpose) ? (clean(raw.zone_key)?.toUpperCase() ?? "") : "";
    const key = `${purpose}:${zoneKey}`;
    byKey.set(key, { purpose, zoneKey, isDefault: raw.is_default === true, copies: Math.max(1, Math.min(20, Math.trunc(Number(raw.copies) || 1))) });
  }
  return Array.from(byKey.values());
}

function roleFor(purposes: PrinterPurpose[]): "receipt" | "kitchen" | "report" {
  if (purposes.some((value) => value === "receipt" || value === "cash_drawer" || value === "reprint" || value === "payment_slip")) return "receipt";
  if (purposes.some((value) => value === "kitchen" || value === "drink" || value === "bar")) return "kitchen";
  if (purposes.includes("shift_report")) return "report";
  return "receipt";
}

function connectionTypeFor(mode: CustomerConnectionMode): PrinterConnectionType {
  if (mode === "lan") return "NETWORK_ESC_POS";
  if (mode === "bluetooth") return "BLUETOOTH_BRIDGE";
  return "LOCAL_BRIDGE";
}

function buildFingerprint(body: Payload, mode: CustomerConnectionMode) {
  const explicit = clean(body.device_fingerprint);
  if (explicit) return explicit.toLowerCase();
  const brand = clean(body.brand)?.toLowerCase() ?? "generic";
  const model = clean(body.model)?.toLowerCase() ?? "printer";
  const runtime = clean(body.runtime_device_code)?.toLowerCase();
  const ip = clean(body.ip_address);
  return [mode, brand, model, runtime ?? ip ?? clean(body.printer_name)?.toLowerCase() ?? "device"].join(":");
}

function profileMetadata(body: Payload, mode: CustomerConnectionMode, purposes: PrinterPurpose[], assignments: PrinterAssignmentInput[]) {
  const drawer = purposes.includes("cash_drawer");
  const runtimeCode = clean(body.runtime_device_code);
  const base = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  return {
    ...base,
    setup_version: "printer_settings_v3",
    routing_version: "tenant_branch_pos_zone_v1",
    user_connection_mode: mode,
    transport_mode: mode,
    agent_transport_mode: mode,
    native_transport: true,
    brand: clean(body.brand),
    model: clean(body.model),
    device_fingerprint: buildFingerprint(body, mode),
    print_functions: purposes,
    print_zones: assignments.filter((assignment) => Boolean(assignment.zoneKey)).map((assignment) => assignment.zoneKey),
    printer_assignments: assignments,
    agent_device_code: runtimeCode ?? undefined,
    agent_device_codes: runtimeCode ? [runtimeCode] : [],
    print_mode: "agent",
    processing_mode: "print_agent",
    queue_only: true,
    bridge_url: mode === "usb" || mode === "bluetooth" ? "native-agent://android-pos" : undefined,
    bluetooth_name: mode === "bluetooth" ? (clean(body.model) ?? clean(body.printer_name)) : undefined,
    cash_drawer_enabled: drawer,
    cash_drawer: drawer ? { enabled: true, connectionMode: "printer-kick", openSupported: true, statusSupported: false, kickPin: 0, pulseOnMs: 50, pulseOffMs: 250, autoOpenOnCashPayment: true } : { enabled: false },
    capabilities: {
      receipt: purposes.includes("receipt"),
      kitchen: purposes.some((value) => value === "kitchen" || value === "drink" || value === "bar"),
      reprint: purposes.includes("reprint"),
      shift_report: purposes.includes("shift_report"),
      payment_slip: purposes.includes("payment_slip"),
      cash_drawer: drawer,
      paper_58: body.paper_width_mm === 58,
      paper_80: body.paper_width_mm === 80
    },
    quarantine_replay_allowed: false
  };
}

function validate(body: Payload) {
  const name = clean(body.printer_name);
  const mode = body.connection_mode;
  const paper = body.paper_width_mm;
  const assignments = normalizeAssignments(body);
  const purposes = Array.from(new Set(assignments.map((assignment) => assignment.purpose)));
  if (!name) throw new Error("printer_name_required");
  if (mode !== "lan" && mode !== "usb" && mode !== "bluetooth") throw new Error("connection_mode_invalid");
  if (paper !== 58 && paper !== 80) throw new Error("paper_width_invalid");
  if (!assignments.length) throw new Error("purpose_required");
  if (mode === "lan" && !clean(body.ip_address)) throw new Error("lan_ip_required");
  return { name, mode, paper, purposes, assignments };
}

async function validateKitchenZones(tenantId: string, branchId: string, assignments: PrinterAssignmentInput[]) {
  const zoneKeys = Array.from(new Set(assignments.filter((assignment) => ZONED_PURPOSES.has(assignment.purpose)).map((assignment) => clean(assignment.zoneKey)?.toUpperCase() ?? "").filter(Boolean)));
  if (zoneKeys.length === 0) return;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("kitchen_zones").select("zone_code").eq("tenant_id", tenantId).eq("branch_id", branchId).eq("is_active", true).in("zone_code", zoneKeys);
  if (error) throw new Error(error.message);
  const found = new Set((data ?? []).map((zone) => String(zone.zone_code).toUpperCase()));
  const missing = zoneKeys.find((zoneKey) => !found.has(zoneKey));
  if (missing) throw new Error(`printer_zone_invalid:${missing}`);
}

function sameDiscoveryIdentity(row: DiscoveredPhysicalRow, body: Payload, mode: CustomerConnectionMode) {
  if (row.connection_mode !== mode) return false;
  const requestedName = clean(body.printer_name)?.toLowerCase();
  const requestedModel = clean(body.model)?.toLowerCase();
  const rowName = clean(row.display_name)?.toLowerCase();
  const rowModel = clean(row.model)?.toLowerCase();
  return Boolean(
    (requestedName && rowName === requestedName) ||
    (requestedModel && rowModel === requestedModel)
  );
}

async function resolveCreatePhysicalTarget(tenantId: string, branchId: string, body: Payload, mode: CustomerConnectionMode): Promise<CreatePhysicalTarget> {
  const explicit = clean(body.device_fingerprint)?.toLowerCase();
  const runtimeCode = clean(body.runtime_device_code);
  const supabase = getSupabaseServiceClient();

  if (explicit) {
    const { data: exact, error: exactError } = await supabase.from("printer_devices")
      .select("id,printer_profile_id,display_name,brand,model,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,disconnected_at,is_active,metadata,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("device_fingerprint", explicit)
      .maybeSingle<DiscoveredPhysicalRow & { printer_profile_id: string | null }>();
    if (exactError) throw new Error(exactError.message);
    if (!exact) {
      return { fingerprint: explicit, discoveredDeviceId: null, discoveredMetadata: {} };
    }
    if (exact.printer_profile_id) throw new Error("printer_physical_target_already_claimed");
    if (!exact.is_active) throw new Error("printer_physical_target_disconnected");
    if (exact.connection_mode !== mode) throw new Error("printer_physical_target_mode_mismatch");
    if (runtimeCode && exact.runtime_device_code && exact.runtime_device_code !== runtimeCode) {
      throw new Error("printer_physical_target_runtime_mismatch");
    }
    return {
      fingerprint: explicit,
      discoveredDeviceId: exact.id,
      discoveredMetadata: asRecord(exact.metadata)
    };
  }

  if (!runtimeCode || mode === "lan") {
    return { fingerprint: buildFingerprint(body, mode), discoveredDeviceId: null, discoveredMetadata: {} };
  }

  const { data, error } = await supabase.from("printer_devices")
    .select("id,display_name,brand,model,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,disconnected_at,is_active,metadata,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("runtime_device_code", runtimeCode)
    .eq("connection_mode", mode)
    .eq("is_active", true)
    .is("printer_profile_id", null)
    .returns<DiscoveredPhysicalRow[]>();
  if (error) throw new Error(error.message);

  const matches = (data ?? []).filter((row) => row.device_fingerprint && sameDiscoveryIdentity(row, body, mode));
  if (matches.length > 1) throw new Error("discovered_printer_ambiguous");
  const match = matches[0];
  if (!match?.device_fingerprint) {
    return { fingerprint: buildFingerprint(body, mode), discoveredDeviceId: null, discoveredMetadata: {} };
  }
  return {
    fingerprint: match.device_fingerprint.toLowerCase(),
    discoveredDeviceId: match.id,
    discoveredMetadata: asRecord(match.metadata)
  };
}

async function claimDiscoveredDevice(tenantId: string, branchId: string, fingerprint: string, printerProfileId: string) {
  const supabase = getSupabaseServiceClient();
  const { data: row, error: lookupError } = await supabase.from("printer_devices")
    .select("id,is_active,printer_profile_id")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("device_fingerprint", fingerprint)
    .maybeSingle<{ id: string; is_active: boolean; printer_profile_id: string | null }>();
  if (lookupError) throw new Error(lookupError.message);
  if (!row) return null;
  if (row.printer_profile_id) throw new Error("printer_physical_target_already_claimed");
  if (!row.is_active) throw new Error("printer_physical_target_disconnected");
  const { error: relinkError } = await supabase.from("printer_devices").update({
    printer_profile_id: printerProfileId,
    status: "checking",
    disconnected_at: null,
    updated_at: new Date().toISOString()
  }).eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", row.id).is("printer_profile_id", null);
  if (relinkError) throw new Error(relinkError.message);
  return row.id;
}

async function loadAutoDiscoveredDevices(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("printer_devices")
    .select("id,printer_profile_id,display_name,brand,model,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,disconnected_at,is_active,metadata,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .is("printer_profile_id", null)
    .order("updated_at", { ascending: false })
    .returns<Array<DiscoveredPhysicalRow & { printer_profile_id: null }>>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    printer_device_assignments: [],
    ip_address: null,
    port: null,
    profile_enabled: false
  }));
}

function validationFailure(message: string) {
  if (message === "lan_ip_required") return fail(message, "LAN ต้องมี IP ของเครื่องพิมพ์", 422);
  if (message.startsWith("printer_zone_invalid:")) return fail("printer_zone_invalid", `ไม่พบโซนครัว ${message.split(":")[1] ?? ""} ในสาขาปัจจุบัน`, 422);
  if (message === "discovered_printer_ambiguous") return fail(message, "พบเครื่องพิมพ์ที่ตรงกันมากกว่า 1 เครื่อง กรุณาเลือก physical target ให้ชัดเจน", 409);
  if (message === "printer_physical_target_already_claimed") return fail(message, "เครื่องพิมพ์ physical นี้ถูกผูกกับเส้นทางพิมพ์แล้ว", 409);
  if (message === "printer_physical_target_disconnected") return fail(message, "เครื่องพิมพ์นี้ถูกผู้ใช้ยกเลิกการเชื่อมต่อไว้ กรุณาเชื่อมต่อใหม่ก่อน", 409);
  if (message === "printer_physical_target_mode_mismatch") return fail(message, "โหมดการเชื่อมต่อไม่ตรงกับเครื่องพิมพ์ที่ตรวจพบ กรุณารีเฟรชรายการแล้วเลือกใหม่", 409);
  if (message === "printer_physical_target_runtime_mismatch") return fail(message, "เครื่องพิมพ์นี้ถูกตรวจพบจากเครื่อง POS คนละเครื่อง กรุณาตั้งค่าเส้นทางจากเครื่อง POS ที่เชื่อมต่อจริง", 409);
  return fail(message, "ข้อมูลเครื่องพิมพ์ไม่ครบ", 422);
}
function isValidationError(message: string) {
  return message === "printer_name_required" || message === "connection_mode_invalid" || message === "paper_width_invalid" || message === "purpose_required" || message === "lan_ip_required" || message === "discovered_printer_ambiguous" || message === "printer_physical_target_already_claimed" || message === "printer_physical_target_disconnected" || message === "printer_physical_target_mode_mismatch" || message === "printer_physical_target_runtime_mismatch" || message.startsWith("printer_zone_invalid:");
}

export async function GET() {
  try {
    const auth = await getPrinterSettingsAuthContext();
    const [registry, discovered] = await Promise.all([
      getPrinterSettingsRegistry(auth),
      loadAutoDiscoveredDevices(auth.tenantId!, auth.branchId!)
    ]);
    return ok({ ...registry, devices: [...discovered, ...registry.devices] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager, owner, or Kitchen can access printer settings.", 403);
    return loggedPrintApiFail("printer registry load failed", error, "printer_registry_load_failed", "ไม่สามารถโหลดรายการเครื่องพิมพ์ได้ กรุณาลองใหม่", 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getPrinterSettingsAuthContext();
    const body = (await req.json()) as Payload;
    const { name, mode, paper, purposes, assignments } = validate(body);
    await validateKitchenZones(auth.tenantId!, auth.branchId!, assignments);
    const target = await resolveCreatePhysicalTarget(auth.tenantId!, auth.branchId!, body, mode);
    const bodyWithFingerprint: Payload = { ...body, device_fingerprint: target.fingerprint };
    const metadata = profileMetadata(bodyWithFingerprint, mode, purposes, assignments);
    const profile = await createPrinterProfile(auth, { printer_name: name, printer_role: roleFor(purposes), connection_type: connectionTypeFor(mode), ip_address: mode === "lan" ? clean(body.ip_address) : null, port: mode === "lan" ? Number(body.port || 9100) : null, paper_width_mm: paper, enabled: body.enabled ?? true, metadata });
    try {
      if (target.discoveredDeviceId) {
        await claimDiscoveredDevice(auth.tenantId!, auth.branchId!, target.fingerprint, profile.id);
      }
      const device = await syncPrinterDevice(auth, {
        printerProfileId: profile.id,
        displayName: name,
        brand: clean(body.brand),
        model: clean(body.model),
        connectionMode: mode,
        paperWidthMm: paper,
        purposes,
        assignments,
        deviceFingerprint: target.fingerprint,
        runtimeDeviceCode: clean(body.runtime_device_code),
        capabilities: (metadata.capabilities ?? {}) as Record<string, unknown>,
        metadata: {
          ...target.discoveredMetadata,
          source: "printer_settings_v3",
          physical_fingerprint: target.fingerprint,
          routing_configured_by_customer: true
        },
        eventType: "connected"
      });
      return ok({ profile, device }, 201);
    } catch (syncError) {
      await deletePrinterProfile(auth, profile.id).catch(() => undefined);
      throw syncError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager, owner, or Kitchen can configure printers.", 403);
    if (isValidationError(message)) return validationFailure(message);
    if (message.includes("duplicate key")) return fail("printer_conflict", "เครื่องพิมพ์นี้ถูกบันทึกไว้แล้ว สามารถเลือกเชื่อมต่ออีกครั้งจากประวัติได้", 409);
    return loggedPrintApiFail("printer create failed", error, "printer_create_failed", "บันทึกเครื่องพิมพ์ไม่สำเร็จ กรุณาลองใหม่", 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getPrinterSettingsAuthContext();
    const body = (await req.json()) as Payload;
    const printerId = clean(body.printer_id);
    if (!printerId) return fail("printer_id_required", "printer_id is required", 422);
    if (body.action === "disconnect") return ok({ device: await disconnectPrinterDevice(auth, printerId), disconnected: true });
    if (body.action === "reconnect") return ok({ device: await reconnectPrinterDevice(auth, printerId), reconnected: true });
    const { name, mode, paper, purposes, assignments } = validate(body);
    await validateKitchenZones(auth.tenantId!, auth.branchId!, assignments);
    const metadata = profileMetadata(body, mode, purposes, assignments);
    const profile = await updatePrinterProfile(auth, printerId, { printer_name: name, printer_role: roleFor(purposes), connection_type: connectionTypeFor(mode), ip_address: mode === "lan" ? clean(body.ip_address) : null, port: mode === "lan" ? Number(body.port || 9100) : null, paper_width_mm: paper, enabled: body.enabled ?? true, metadata });
    const device = await syncPrinterDevice(auth, { printerProfileId: profile.id, displayName: name, brand: clean(body.brand), model: clean(body.model), connectionMode: mode, paperWidthMm: paper, purposes, assignments, deviceFingerprint: buildFingerprint(body, mode), runtimeDeviceCode: clean(body.runtime_device_code), capabilities: (metadata.capabilities ?? {}) as Record<string, unknown>, metadata: { source: "printer_settings_v3" }, eventType: "updated" });
    return ok({ profile, device });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager, owner, or Kitchen can configure printers.", 403);
    if (message === "printer_not_found" || message === "printer_device_not_found") return fail("printer_not_found", "ไม่พบเครื่องพิมพ์นี้", 404);
    if (isValidationError(message)) return validationFailure(message);
    if (message.includes("duplicate key")) return fail("printer_conflict", "Printer name already exists in this branch.", 409);
    return loggedPrintApiFail("printer update failed", error, "printer_update_failed", "อัปเดตเครื่องพิมพ์ไม่สำเร็จ กรุณาลองใหม่", 400);
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getPrinterSettingsAuthContext();
    const body = (await req.json()) as Payload;
    const printerId = clean(body.printer_id);
    if (!printerId) return fail("printer_id_required", "printer_id is required", 422);
    await disconnectPrinterDevice(auth, printerId);
    await markPrinterDeviceDeleted(auth, printerId);
    return ok({ deleted: true, recoverable: true, printer_id: printerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager, owner, or Kitchen can delete printers.", 403);
    if (message === "printer_not_found") return fail("printer_not_found", "ไม่พบเครื่องพิมพ์นี้", 404);
    return loggedPrintApiFail("printer delete failed", error, "printer_delete_failed", "ลบเครื่องพิมพ์ไม่สำเร็จ กรุณาลองใหม่", 400);
  }
}
