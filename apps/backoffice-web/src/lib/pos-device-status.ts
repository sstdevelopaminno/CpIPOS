import "server-only";

import type { PosSessionRow } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type PosRuntimeDeviceStatus = "active" | "inactive" | "maintenance" | "unknown";
export type PosRuntimeMainMenuPlacement = "left" | "top" | "bottom";

export type PosRuntimeDevicePolicy = {
  id: string | null;
  code: string | null;
  name: string | null;
  status: PosRuntimeDeviceStatus;
  block_sales: boolean;
  reason_code: "pos_device_inactive" | "pos_device_maintenance" | null;
  main_menu_placement: PosRuntimeMainMenuPlacement | null;
};

type DeviceRow = {
  id: string;
  device_code: string | null;
  device_name: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

type DevicePolicyCacheEntry = {
  value: PosRuntimeDevicePolicy;
  expiresAt: number;
};

const DEVICE_POLICY_CACHE_TTL_MS = 15_000;

function getDevicePolicyCache() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __posRuntimeDevicePolicyCache?: Map<string, DevicePolicyCacheEntry>;
  };
  if (!scopedGlobal.__posRuntimeDevicePolicyCache) {
    scopedGlobal.__posRuntimeDevicePolicyCache = new Map<string, DevicePolicyCacheEntry>();
  }
  return scopedGlobal.__posRuntimeDevicePolicyCache;
}

function devicePolicyCacheKey(input: { tenantId: string; branchId: string; deviceId: string | null; deviceCode: string | null }) {
  return [input.tenantId, input.branchId, input.deviceId ?? "", input.deviceCode ?? ""].join(":");
}

function readDevicePolicyCache(key: string) {
  const cache = getDevicePolicyCache();
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeDevicePolicyCache(key: string, value: PosRuntimeDevicePolicy) {
  getDevicePolicyCache().set(key, {
    value,
    expiresAt: Date.now() + DEVICE_POLICY_CACHE_TTL_MS
  });
}

const ACTIVE_DEVICE_POLICY: PosRuntimeDevicePolicy = {
  id: null,
  code: null,
  name: null,
  status: "active",
  block_sales: false,
  reason_code: null,
  main_menu_placement: null
};

function normalizeDeviceStatus(value: unknown): PosRuntimeDeviceStatus {
  if (value === "inactive" || value === "maintenance") return value;
  if (value === "active") return "active";
  return "unknown";
}

function normalizeMainMenuPlacement(value: unknown): PosRuntimeMainMenuPlacement | null {
  if (value === "left" || value === "top" || value === "bottom") return value;
  return null;
}

function policyFromRow(row: DeviceRow | null, fallbackCode: string | null): PosRuntimeDevicePolicy {
  if (!row) {
    return {
      ...ACTIVE_DEVICE_POLICY,
      code: fallbackCode,
      status: "unknown"
    };
  }
  const status = normalizeDeviceStatus(row.status);
  const blockSales = status === "inactive" || status === "maintenance";
  return {
    id: row.id,
    code: row.device_code ?? fallbackCode,
    name: row.device_name,
    status,
    block_sales: blockSales,
    reason_code: status === "inactive" ? "pos_device_inactive" : status === "maintenance" ? "pos_device_maintenance" : null,
    main_menu_placement: normalizeMainMenuPlacement(row.metadata?.pos_main_menu_placement)
  };
}

function isDeviceSchemaUnavailable(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("branch_devices") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

export async function loadPosRuntimeDevicePolicy(input: {
  tenantId: string;
  branchId: string;
  deviceId?: string | null;
  deviceCode?: string | null;
}): Promise<PosRuntimeDevicePolicy> {
  const tenantId = input.tenantId.trim();
  const branchId = input.branchId.trim();
  const deviceId = input.deviceId?.trim() || null;
  const deviceCode = input.deviceCode?.trim() || null;

  if (!tenantId || !branchId || (!deviceId && !deviceCode)) {
    return { ...ACTIVE_DEVICE_POLICY, id: deviceId, code: deviceCode };
  }

  const cacheKey = devicePolicyCacheKey({ tenantId, branchId, deviceId, deviceCode });
  const cached = readDevicePolicyCache(cacheKey);
  if (cached) return cached;

  const supabase = getSupabaseServiceClient();
  const baseQuery = supabase
    .from("branch_devices")
    .select("id,device_code,device_name,status,metadata")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId);
  const query = deviceId ? baseQuery.eq("id", deviceId) : baseQuery.eq("device_code", deviceCode);
  const { data, error } = await query.maybeSingle<DeviceRow>();

  if (error) {
    if (!isDeviceSchemaUnavailable(error)) {
      console.warn("[pos-device-status] device policy lookup failed", {
        tenantId,
        branchId,
        deviceId,
        deviceCode,
        errorCode: error.code ?? null,
        errorMessage: error.message ?? "Unknown error"
      });
    }
    return { ...ACTIVE_DEVICE_POLICY, id: deviceId, code: deviceCode };
  }

  const resolved = policyFromRow(data ?? null, deviceCode);
  writeDevicePolicyCache(cacheKey, resolved);
  return resolved;
}

export function loadPosRuntimeDevicePolicyForSession(session: PosSessionRow) {
  return loadPosRuntimeDevicePolicy({
    tenantId: session.tenant_id,
    branchId: session.branch_id,
    deviceId: session.device_id,
    deviceCode: session.device_code
  });
}

export function getDevicePolicyBlockMessage(policy: PosRuntimeDevicePolicy) {
  if (policy.status === "inactive") {
    return "Cashier device is disabled.";
  }
  if (policy.status === "maintenance") {
    return "Cashier device is under maintenance.";
  }
  return "Cashier device is not available.";
}
