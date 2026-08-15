import "server-only";

import type { PrinterProfile } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type PrinterRoutingPurpose =
  | "receipt"
  | "kitchen"
  | "drink"
  | "bar"
  | "reprint"
  | "shift_report"
  | "payment_slip"
  | "cash_drawer";

type LegacyPrinterRole = "receipt" | "kitchen" | "report";
type PrinterProfileRow = PrinterProfile & { created_by?: string | null };

type AssignmentRow = {
  id: string;
  printer_device_id: string;
  purpose: PrinterRoutingPurpose;
  zone_key: string;
  is_default: boolean;
  copies: number;
  created_at: string;
};

type DeviceRow = {
  id: string;
  printer_profile_id: string | null;
  runtime_device_code: string | null;
  is_active: boolean;
  status: string;
  created_at: string;
};

export type ResolvedPrinterRoute = {
  printer: PrinterProfileRow;
  printerDeviceId: string | null;
  runtimeDeviceCode: string | null;
  purpose: PrinterRoutingPurpose;
  zoneKey: string;
  copies: number;
  isDefault: boolean;
  source: "assignment" | "legacy_role";
};

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeZone(value: string | null | undefined) {
  return clean(value)?.toUpperCase() ?? "";
}

function readStringArray(value: unknown) {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function profileRuntimeCodes(printer: PrinterProfileRow) {
  const metadata = printer.metadata && typeof printer.metadata === "object" && !Array.isArray(printer.metadata)
    ? (printer.metadata as Record<string, unknown>)
    : {};
  return readStringArray(
    metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.runtime_device_code ?? metadata.device_code ?? metadata.device_codes
  );
}

async function loadLegacyRoleRoutes(args: {
  auth: AuthContext;
  role: LegacyPrinterRole;
  purpose: PrinterRoutingPurpose;
  runtimeDeviceCode?: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .eq("tenant_id", args.auth.tenantId!)
    .eq("branch_id", args.auth.branchId!)
    .eq("printer_role", args.role)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const runtimeCode = clean(args.runtimeDeviceCode);
  let profiles = (data ?? []) as PrinterProfileRow[];
  if (runtimeCode) {
    const exact = profiles.filter((profile) => profileRuntimeCodes(profile).includes(runtimeCode));
    if (exact.length > 0) {
      profiles = exact;
    } else {
      profiles = profiles.filter((profile) => profileRuntimeCodes(profile).length === 0);
    }
  }

  return profiles.map<ResolvedPrinterRoute>((printer) => ({
    printer,
    printerDeviceId: null,
    runtimeDeviceCode: runtimeCode,
    purpose: args.purpose,
    zoneKey: "",
    copies: 1,
    isDefault: false,
    source: "legacy_role"
  }));
}

function selectAssignmentRows(args: {
  assignments: AssignmentRow[];
  devicesById: Map<string, DeviceRow>;
  purpose: PrinterRoutingPurpose;
  runtimeDeviceCode?: string | null;
  zoneKey?: string | null;
}) {
  const runtimeCode = clean(args.runtimeDeviceCode);
  const requestedZone = normalizeZone(args.zoneKey);
  const canFanOut = args.purpose === "kitchen" || args.purpose === "drink" || args.purpose === "bar";

  let assignments = args.assignments.filter((assignment) => args.devicesById.has(assignment.printer_device_id));

  if (requestedZone) {
    const exactZone = assignments.filter((assignment) => normalizeZone(assignment.zone_key) === requestedZone);
    assignments = exactZone.length > 0 ? exactZone : assignments.filter((assignment) => !normalizeZone(assignment.zone_key));
  } else {
    const branchWide = assignments.filter((assignment) => !normalizeZone(assignment.zone_key));
    if (branchWide.length > 0) assignments = branchWide;
  }

  if (runtimeCode) {
    const exactDevice = assignments.filter((assignment) => {
      const device = args.devicesById.get(assignment.printer_device_id);
      return clean(device?.runtime_device_code) === runtimeCode;
    });
    if (exactDevice.length > 0) {
      assignments = exactDevice;
    } else {
      const branchDefault = assignments.filter((assignment) => {
        const device = args.devicesById.get(assignment.printer_device_id);
        return !clean(device?.runtime_device_code);
      });
      assignments = branchDefault.length > 0 ? branchDefault : [];
    }
  } else {
    if (!canFanOut) {
      const explicitDefaults = assignments.filter((assignment) => assignment.is_default);
      if (explicitDefaults.length > 0) {
        assignments = explicitDefaults;
      } else {
        const branchDefault = assignments.filter((assignment) => {
          const device = args.devicesById.get(assignment.printer_device_id);
          return !clean(device?.runtime_device_code);
        });
        if (branchDefault.length > 0) assignments = branchDefault;
      }
    } else if (!assignments.some((assignment) => assignment.is_default)) {
      const branchDefault = assignments.filter((assignment) => {
        const device = args.devicesById.get(assignment.printer_device_id);
        return !clean(device?.runtime_device_code);
      });
      if (branchDefault.length > 0) assignments = branchDefault;
    }
  }

  return assignments.sort((left, right) => {
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
    const leftDevice = args.devicesById.get(left.printer_device_id);
    const rightDevice = args.devicesById.get(right.printer_device_id);
    if (runtimeCode) {
      const leftExact = clean(leftDevice?.runtime_device_code) === runtimeCode;
      const rightExact = clean(rightDevice?.runtime_device_code) === runtimeCode;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
    }
    return left.created_at.localeCompare(right.created_at);
  });
}

export async function resolvePrinterRoutes(args: {
  auth: AuthContext;
  purpose: PrinterRoutingPurpose;
  fallbackPurposes?: PrinterRoutingPurpose[];
  runtimeDeviceCode?: string | null;
  zoneKey?: string | null;
  legacyRole: LegacyPrinterRole;
}): Promise<ResolvedPrinterRoute[]> {
  if (!args.auth.tenantId || !args.auth.branchId) throw new Error("printer_route_scope_required");
  const supabase = getSupabaseServiceClient();
  const purposeCandidates = Array.from(new Set([args.purpose, ...(args.fallbackPurposes ?? [])]));

  for (const purpose of purposeCandidates) {
    const { data: assignmentData, error: assignmentError } = await supabase
      .from("printer_device_assignments")
      .select("id,printer_device_id,purpose,zone_key,is_default,copies,created_at")
      .eq("tenant_id", args.auth.tenantId)
      .eq("branch_id", args.auth.branchId)
      .eq("purpose", purpose)
      .eq("is_enabled", true)
      .order("created_at", { ascending: true });
    if (assignmentError) throw new Error(assignmentError.message);

    const assignments = (assignmentData ?? []) as AssignmentRow[];
    if (assignments.length === 0) continue;

    const deviceIds = Array.from(new Set(assignments.map((assignment) => assignment.printer_device_id)));
    const { data: deviceData, error: deviceError } = await supabase
      .from("printer_devices")
      .select("id,printer_profile_id,runtime_device_code,is_active,status,created_at")
      .eq("tenant_id", args.auth.tenantId)
      .eq("branch_id", args.auth.branchId)
      .in("id", deviceIds)
      .eq("is_active", true);
    if (deviceError) throw new Error(deviceError.message);

    const devices = (deviceData ?? []) as DeviceRow[];
    const devicesById = new Map(devices.filter((device) => device.printer_profile_id).map((device) => [device.id, device]));
    const selectedAssignments = selectAssignmentRows({
      assignments,
      devicesById,
      purpose,
      runtimeDeviceCode: args.runtimeDeviceCode,
      zoneKey: args.zoneKey
    });
    if (selectedAssignments.length === 0) continue;

    const profileIds = Array.from(new Set(selectedAssignments.flatMap((assignment) => {
      const profileId = devicesById.get(assignment.printer_device_id)?.printer_profile_id;
      return profileId ? [profileId] : [];
    })));
    if (profileIds.length === 0) continue;

    const { data: profileData, error: profileError } = await supabase
      .from("printer_profiles")
      .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
      .eq("tenant_id", args.auth.tenantId)
      .eq("branch_id", args.auth.branchId)
      .in("id", profileIds)
      .eq("enabled", true);
    if (profileError) throw new Error(profileError.message);

    const profilesById = new Map(((profileData ?? []) as PrinterProfileRow[]).map((profile) => [profile.id, profile]));
    const routes = selectedAssignments.flatMap<ResolvedPrinterRoute>((assignment) => {
      const device = devicesById.get(assignment.printer_device_id);
      if (!device?.printer_profile_id) return [];
      const printer = profilesById.get(device.printer_profile_id);
      if (!printer) return [];
      return [{
        printer,
        printerDeviceId: device.id,
        runtimeDeviceCode: clean(device.runtime_device_code),
        purpose,
        zoneKey: normalizeZone(assignment.zone_key),
        copies: Math.max(1, Math.min(20, Number(assignment.copies) || 1)),
        isDefault: assignment.is_default,
        source: "assignment"
      }];
    });
    if (routes.length > 0) return routes;
  }

  return loadLegacyRoleRoutes({
    auth: args.auth,
    role: args.legacyRole,
    purpose: args.purpose,
    runtimeDeviceCode: args.runtimeDeviceCode
  });
}
