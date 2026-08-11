import type { PrinterConnectionType } from "@pos/shared-types";
import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { createPrinterProfile, deletePrinterProfile, updatePrinterProfile } from "@/lib/printing/print-service";
import {
  disconnectPrinterDevice,
  getPrinterSettingsRegistry,
  markPrinterDeviceDeleted,
  reconnectPrinterDevice,
  syncPrinterDevice,
  type CustomerConnectionMode,
  type PrinterPurpose
} from "@/lib/printing/printer-device-registry";

type Payload = {
  printer_id?: string | null;
  printer_name?: string | null;
  brand?: string | null;
  model?: string | null;
  connection_mode?: CustomerConnectionMode | null;
  paper_width_mm?: 58 | 80 | null;
  purposes?: PrinterPurpose[] | null;
  ip_address?: string | null;
  port?: number | null;
  runtime_device_code?: string | null;
  device_fingerprint?: string | null;
  enabled?: boolean;
  action?: "disconnect" | "reconnect" | null;
  metadata?: Record<string, unknown> | null;
};

const PURPOSES = new Set<PrinterPurpose>(["receipt","kitchen","drink","bar","reprint","shift_report","payment_slip","cash_drawer"]);

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePurposes(values: unknown): PrinterPurpose[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is PrinterPurpose => typeof value === "string" && PURPOSES.has(value as PrinterPurpose))));
}

function roleFor(purposes: PrinterPurpose[]): "receipt" | "kitchen" | "report" {
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
  if (explicit) return explicit;
  const brand = clean(body.brand)?.toLowerCase() ?? "generic";
  const model = clean(body.model)?.toLowerCase() ?? "printer";
  const runtime = clean(body.runtime_device_code)?.toLowerCase();
  const ip = clean(body.ip_address);
  return [mode, brand, model, runtime ?? ip ?? clean(body.printer_name)?.toLowerCase() ?? "device"].join(":");
}

function profileMetadata(body: Payload, mode: CustomerConnectionMode, purposes: PrinterPurpose[]) {
  const drawer = purposes.includes("cash_drawer");
  const runtimeCode = clean(body.runtime_device_code);
  const base = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  return {
    ...base,
    setup_version: "printer_settings_v3",
    user_connection_mode: mode,
    transport_mode: mode,
    brand: clean(body.brand),
    model: clean(body.model),
    device_fingerprint: buildFingerprint(body, mode),
    print_functions: purposes,
    print_zones: purposes,
    agent_device_code: runtimeCode ?? undefined,
    agent_device_codes: runtimeCode ? [runtimeCode] : [],
    print_mode: mode === "lan" ? "server" : "agent",
    queue_only: mode !== "lan",
    bridge_url: mode === "lan" ? undefined : "browser-agent://web-serial",
    bluetooth_name: mode === "bluetooth" ? (clean(body.model) ?? clean(body.printer_name)) : undefined,
    cash_drawer_enabled: drawer,
    cash_drawer: drawer ? {
      enabled: true,
      connectionMode: "printer-kick",
      openSupported: true,
      statusSupported: false,
      kickPin: 0,
      pulseOnMs: 50,
      pulseOffMs: 250,
      autoOpenOnCashPayment: true
    } : { enabled: false },
    capabilities: {
      receipt: purposes.includes("receipt"),
      kitchen: purposes.some((value) => value === "kitchen" || value === "drink" || value === "bar"),
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
  const purposes = normalizePurposes(body.purposes);
  if (!name) throw new Error("printer_name_required");
  if (mode !== "lan" && mode !== "usb" && mode !== "bluetooth") throw new Error("connection_mode_invalid");
  if (paper !== 58 && paper !== 80) throw new Error("paper_width_invalid");
  if (!purposes.length) throw new Error("purpose_required");
  if (mode === "lan" && !clean(body.ip_address)) throw new Error("lan_ip_required");
  return { name, mode, paper, purposes };
}

function validationFailure(message: string) {
  if (message === "lan_ip_required") return fail(message, "LAN ต้องมี IP ของเครื่องพิมพ์", 422);
  return fail(message, "ข้อมูลเครื่องพิมพ์ไม่ครบ", 422);
}

function isValidationError(message: string) {
  return message === "printer_name_required" || message === "connection_mode_invalid" || message === "paper_width_invalid" || message === "purpose_required" || message === "lan_ip_required";
}

export async function GET() {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    return ok(await getPrinterSettingsRegistry(auth));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can access printer settings.", 403);
    return fail("printer_registry_load_failed", "ไม่สามารถโหลดรายการเครื่องพิมพ์ได้ กรุณาลองใหม่", 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as Payload;
    const { name, mode, paper, purposes } = validate(body);
    const metadata = profileMetadata(body, mode, purposes);
    const profile = await createPrinterProfile(auth, {
      printer_name: name,
      printer_role: roleFor(purposes),
      connection_type: connectionTypeFor(mode),
      ip_address: mode === "lan" ? clean(body.ip_address) : null,
      port: mode === "lan" ? Number(body.port || 9100) : null,
      paper_width_mm: paper,
      enabled: body.enabled ?? true,
      metadata
    });
    const device = await syncPrinterDevice(auth, {
      printerProfileId: profile.id,
      displayName: name,
      brand: clean(body.brand), model: clean(body.model), connectionMode: mode, paperWidthMm: paper,
      purposes, deviceFingerprint: buildFingerprint(body, mode), runtimeDeviceCode: clean(body.runtime_device_code),
      capabilities: (metadata.capabilities ?? {}) as Record<string, unknown>, metadata: { source: "printer_settings_v3" }, eventType: "connected"
    });
    return ok({ profile, device }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can configure printers.", 403);
    if (isValidationError(message)) return validationFailure(message);
    if (message.includes("duplicate key")) return fail("printer_conflict", "เครื่องพิมพ์นี้ถูกบันทึกไว้แล้ว สามารถเลือกเชื่อมต่ออีกครั้งจากประวัติได้", 409);
    return fail("printer_create_failed", "บันทึกเครื่องพิมพ์ไม่สำเร็จ กรุณาลองใหม่", 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as Payload;
    const printerId = clean(body.printer_id);
    if (!printerId) return fail("printer_id_required", "printer_id is required", 422);

    if (body.action === "disconnect") {
      const device = await disconnectPrinterDevice(auth, printerId);
      return ok({ device, disconnected: true });
    }
    if (body.action === "reconnect") {
      const device = await reconnectPrinterDevice(auth, printerId);
      return ok({ device, reconnected: true });
    }

    const { name, mode, paper, purposes } = validate(body);
    const metadata = profileMetadata(body, mode, purposes);
    const profile = await updatePrinterProfile(auth, printerId, {
      printer_name: name,
      printer_role: roleFor(purposes),
      connection_type: connectionTypeFor(mode),
      ip_address: mode === "lan" ? clean(body.ip_address) : null,
      port: mode === "lan" ? Number(body.port || 9100) : null,
      paper_width_mm: paper,
      enabled: body.enabled ?? true,
      metadata
    });
    const device = await syncPrinterDevice(auth, {
      printerProfileId: profile.id, displayName: name, brand: clean(body.brand), model: clean(body.model), connectionMode: mode,
      paperWidthMm: paper, purposes, deviceFingerprint: buildFingerprint(body, mode), runtimeDeviceCode: clean(body.runtime_device_code),
      capabilities: (metadata.capabilities ?? {}) as Record<string, unknown>, metadata: { source: "printer_settings_v3" }, eventType: "updated"
    });
    return ok({ profile, device });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can configure printers.", 403);
    if (message === "printer_not_found" || message === "printer_device_not_found") return fail("printer_not_found", "ไม่พบเครื่องพิมพ์นี้", 404);
    if (isValidationError(message)) return validationFailure(message);
    return fail("printer_update_failed", "อัปเดตเครื่องพิมพ์ไม่สำเร็จ กรุณาลองใหม่", 400);
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as Payload;
    const printerId = clean(body.printer_id);
    if (!printerId) return fail("printer_id_required", "printer_id is required", 422);
    await markPrinterDeviceDeleted(auth, printerId);
    const deleted = await deletePrinterProfile(auth, printerId);
    return ok({ deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can delete printers.", 403);
    if (message === "printer_not_found") return fail("printer_not_found", "ไม่พบเครื่องพิมพ์นี้", 404);
    return fail("printer_delete_failed", "ลบเครื่องพิมพ์ไม่สำเร็จ กรุณาลองใหม่", 400);
  }
}
