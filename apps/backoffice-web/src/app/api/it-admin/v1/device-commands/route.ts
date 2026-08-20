import { appendAuditLog } from "@/lib/audit-log";
import {
  DEVICE_COMMAND_TTL_MS,
  isDeviceCommandType,
  isImmediateDeviceCommand,
  type DeviceCommandType
} from "@/lib/device-commands";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

type DeviceCommandRequestBody = {
  tenant_id?: string;
  branch_id?: string;
  pos_device_id?: string;
  command_type?: string;
  metadata?: unknown;
};

type BranchDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  status: string;
};

type PrinterVerificationMode = "probe" | "verification_print";
type PrinterVerificationMetadata = {
  printer_verification: {
    mode: PrinterVerificationMode;
    target_fingerprint: string;
    operator_confirmed: boolean;
  };
};

type ParsedCommandMetadata = {
  metadata: PrinterVerificationMetadata | null;
  expiresInMs: number;
  error: { code: string; message: string } | null;
};

const PRINTER_PROBE_TTL_MS = 30 * 60_000;
const PRINTER_VERIFICATION_PRINT_TTL_MS = 5 * 60_000;
const USB_FINGERPRINT = /^usb:vid[0-9a-f]{4}:pid[0-9a-f]{4}:(serial|path):[a-z0-9._-]+$/;
const BLUETOOTH_FINGERPRINT = /^bluetooth:mac:[0-9a-f]{12}$/;
const LAN_FINGERPRINT = /^lan:host:([a-z0-9._-]+):port:([0-9]{1,5})$/;

function sanitizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isCanonicalPrinterFingerprint(value: string): boolean {
  if (USB_FINGERPRINT.test(value) || BLUETOOTH_FINGERPRINT.test(value)) return true;
  const lan = LAN_FINGERPRINT.exec(value);
  if (!lan) return false;
  const port = Number(lan[2]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function parseCommandMetadata(commandType: DeviceCommandType, rawMetadata: unknown): ParsedCommandMetadata {
  if (rawMetadata == null) {
    return { metadata: null, expiresInMs: DEVICE_COMMAND_TTL_MS, error: null };
  }

  if (commandType !== "test_printer") {
    return {
      metadata: null,
      expiresInMs: DEVICE_COMMAND_TTL_MS,
      error: {
        code: "command_metadata_not_allowed",
        message: "Command metadata is only supported for test_printer verification commands."
      }
    };
  }

  const metadata = asRecord(rawMetadata);
  const metadataKeys = Object.keys(metadata);
  if (metadataKeys.length !== 1 || metadataKeys[0] !== "printer_verification") {
    return {
      metadata: null,
      expiresInMs: DEVICE_COMMAND_TTL_MS,
      error: {
        code: "invalid_printer_verification_metadata",
        message: "test_printer metadata must contain only printer_verification."
      }
    };
  }

  const verification = asRecord(metadata.printer_verification);
  const verificationKeys = Object.keys(verification);
  const allowedKeys = new Set(["mode", "target_fingerprint", "operator_confirmed"]);
  if (verificationKeys.some((key) => !allowedKeys.has(key))) {
    return {
      metadata: null,
      expiresInMs: DEVICE_COMMAND_TTL_MS,
      error: {
        code: "invalid_printer_verification_metadata",
        message: "Unknown printer_verification metadata field."
      }
    };
  }

  const modeRaw = typeof verification.mode === "string" ? verification.mode.trim().toLowerCase() : "";
  if (modeRaw !== "probe" && modeRaw !== "verification_print") {
    return {
      metadata: null,
      expiresInMs: DEVICE_COMMAND_TTL_MS,
      error: {
        code: "invalid_printer_verification_mode",
        message: "printer_verification.mode must be probe or verification_print."
      }
    };
  }
  const mode: PrinterVerificationMode = modeRaw;

  const targetFingerprint = typeof verification.target_fingerprint === "string"
    ? verification.target_fingerprint.trim().toLowerCase()
    : "";
  if (!targetFingerprint || targetFingerprint.length > 240 || !isCanonicalPrinterFingerprint(targetFingerprint)) {
    return {
      metadata: null,
      expiresInMs: DEVICE_COMMAND_TTL_MS,
      error: {
        code: "invalid_printer_fingerprint",
        message: "target_fingerprint must be a canonical USB, Bluetooth, or LAN printer fingerprint."
      }
    };
  }

  if (verification.operator_confirmed != null && typeof verification.operator_confirmed !== "boolean") {
    return {
      metadata: null,
      expiresInMs: DEVICE_COMMAND_TTL_MS,
      error: {
        code: "invalid_operator_confirmation",
        message: "operator_confirmed must be a boolean."
      }
    };
  }
  const operatorConfirmed = verification.operator_confirmed === true;
  if (mode === "verification_print" && !operatorConfirmed) {
    return {
      metadata: null,
      expiresInMs: PRINTER_VERIFICATION_PRINT_TTL_MS,
      error: {
        code: "operator_confirmation_required",
        message: "One-time verification print requires explicit operator confirmation."
      }
    };
  }

  return {
    metadata: {
      printer_verification: {
        mode,
        target_fingerprint: targetFingerprint,
        operator_confirmed: operatorConfirmed
      }
    },
    expiresInMs: mode === "verification_print" ? PRINTER_VERIFICATION_PRINT_TTL_MS : PRINTER_PROBE_TTL_MS,
    error: null
  };
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();

    const rateLimit = await enforceRateLimit({
      namespace: "it_admin_device_command",
      key: auth.userId,
      max: 30,
      windowMs: 60_000
    });
    if (!rateLimit.ok) {
      return fail("rate_limited", "Too many device commands issued. Please wait and try again.", 429);
    }

    const body = (await req.json().catch(() => ({}))) as DeviceCommandRequestBody;
    const tenantId = sanitizeId(body.tenant_id);
    const branchId = sanitizeId(body.branch_id);
    const posDeviceId = sanitizeId(body.pos_device_id);
    const commandTypeRaw = sanitizeId(body.command_type);

    if (!tenantId || !branchId || !posDeviceId) {
      return fail("missing_scope", "tenant_id, branch_id, and pos_device_id are required.", 422);
    }
    if (!isDeviceCommandType(commandTypeRaw)) {
      return fail("invalid_command_type", "Unknown device command type.", 422);
    }
    const commandType: DeviceCommandType = commandTypeRaw;
    const parsedMetadata = parseCommandMetadata(commandType, body.metadata);
    if (parsedMetadata.error) {
      return fail(parsedMetadata.error.code, parsedMetadata.error.message, 422);
    }

    const { data: device, error: deviceError } = await supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,status")
      .eq("id", posDeviceId)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .maybeSingle<BranchDeviceRow>();

    if (deviceError) throw new Error(deviceError.message);
    if (!device) return fail("device_not_found", "Device was not found for this tenant/branch.", 404);

    const now = new Date();
    const isImmediate = isImmediateDeviceCommand(commandType);

    if (isImmediate) {
      const nextStatus = commandType === "disable_device" ? "inactive" : "active";
      const { error: updateError } = await supabase
        .from("branch_devices")
        .update({ status: nextStatus, updated_at: now.toISOString() })
        .eq("id", device.id);
      if (updateError) throw new Error(updateError.message);
    }

    const { data: commandRow, error: insertError } = await supabase
      .from("device_commands")
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        pos_device_id: device.id,
        command_type: commandType,
        status: isImmediate ? "delivered" : "pending",
        issued_by_user_id: auth.userId,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + parsedMetadata.expiresInMs).toISOString(),
        delivered_at: isImmediate ? now.toISOString() : null,
        metadata: parsedMetadata.metadata ?? {},
        result: isImmediate ? { applied: true } : {}
      })
      .select("id,command_type,status,issued_at,expires_at,delivered_at,metadata")
      .single();

    if (insertError || !commandRow) {
      throw new Error(insertError?.message ?? "Failed to issue device command.");
    }

    await appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: auth.platformRole,
      action: "device_command_issued",
      targetTable: "device_commands",
      targetId: commandRow.id,
      metadata: {
        device_id: device.id,
        device_code: device.device_code,
        command_type: commandType,
        immediate: isImmediate,
        printer_verification: parsedMetadata.metadata?.printer_verification ?? null
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    const response = ok({ command: commandRow });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
