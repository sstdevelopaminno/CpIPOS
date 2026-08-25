import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { readPreEntryFlowState } from "@/lib/server/pre-entry-state";
import { POST as selectDevice } from "./select-handler";

type JsonRecord = Record<string, unknown>;

type PairingRequestBody = {
  device_code?: string;
  android_install_id?: string | null;
  android_app_version?: string | null;
};

type PairingDeviceRow = {
  id: string;
  device_code: string;
  metadata: JsonRecord | null;
};

type PairingConflictRow = {
  id: string;
  device_code: string;
};

type LabRoamingDeviceRow = {
  id: string;
  tenant_id: string;
  device_code: string;
  metadata: JsonRecord | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const forwardedRequest = request.clone();
  const body = (await request.json().catch(() => null)) as PairingRequestBody | null;
  const installId = String(body?.android_install_id ?? "").trim();

  // Normal browser/device-selection behavior remains unchanged. Pairing is only
  // activated when the trusted Android WebView bridge supplies its install id.
  if (!installId) return selectDevice(forwardedRequest);

  if (request.headers.get("x-cpipos-android-pos") !== "true") {
    return jsonError(401, "android_pos_required", "Android POS runtime is required for device pairing.");
  }
  if (!UUID_PATTERN.test(installId)) {
    return jsonError(422, "android_install_id_invalid", "Android install id ไม่ถูกต้อง กรุณาเปิดแอป CpiPOS ใหม่แล้วลองอีกครั้ง");
  }

  const selectedDeviceCode = String(body?.device_code ?? "").trim().toUpperCase();
  const appVersion = String(body?.android_app_version ?? "").trim().slice(0, 40) || null;
  if (!selectedDeviceCode) return selectDevice(forwardedRequest);

  const cookieStore = await cookies();
  const flow = readPreEntryFlowState(cookieStore);
  if (!flow?.tenantId || !flow.branchId || !flow.userId) {
    return selectDevice(forwardedRequest);
  }

  const supabase = getSupabaseServiceClient();

  // A physical Android install explicitly marked as an internal LAB roaming
  // device may QA multiple product profiles/tenants without moving its native
  // install binding onto a customer's logical POS. This exception is keyed by
  // the exact install id and an explicit server-side metadata flag; ordinary
  // customer installations continue through the global uniqueness guard below.
  const { data: labRows, error: labLookupError } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,device_code,metadata")
    .eq("is_active", true)
    .contains("metadata", {
      android_mdm_install_id: installId,
      android_lab_roaming: true
    })
    .limit(1)
    .returns<LabRoamingDeviceRow[]>();

  if (labLookupError) {
    console.warn("[auth/devices/select] LAB roaming lookup degraded; using normal pairing guard", {
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      deviceCode: selectedDeviceCode,
      error: labLookupError.message
    });
  }

  const labDevice = labRows?.[0] ?? null;
  if (labDevice) {
    const response = await selectDevice(forwardedRequest);
    if (response.ok) {
      response.headers.set("x-cpipos-android-pairing", "lab-roaming");
      response.headers.set("x-cpipos-lab-device", labDevice.device_code);
    }
    return response;
  }

  const { data: device, error: deviceError } = await supabase
    .from("branch_devices")
    .select("id,device_code,metadata")
    .eq("tenant_id", flow.tenantId)
    .eq("branch_id", flow.branchId)
    .eq("device_code", selectedDeviceCode)
    .maybeSingle<PairingDeviceRow>();

  if (deviceError) {
    console.error("[auth/devices/select] android pairing device lookup failed", {
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      deviceCode: selectedDeviceCode,
      error: deviceError.message
    });
    return jsonError(500, "android_pairing_failed", "ไม่สามารถตรวจสอบการจับคู่ Android POS ได้ กรุณาลองใหม่");
  }
  if (!device) return selectDevice(forwardedRequest);

  // install_id identifies one physical Android app installation and must be
  // globally unique across tenants. Scoping this lookup to the current tenant
  // can leave a stale native MDM/Print Agent key authenticated to another store.
  const { data: conflictingDevices, error: conflictError } = await supabase
    .from("branch_devices")
    .select("id,device_code")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .neq("id", device.id)
    .limit(1)
    .returns<PairingConflictRow[]>();

  if (conflictError) {
    console.error("[auth/devices/select] android pairing conflict lookup failed", {
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      deviceCode: selectedDeviceCode,
      error: conflictError.message
    });
    return jsonError(500, "android_pairing_failed", "ไม่สามารถตรวจสอบการจับคู่ Android POS ได้ กรุณาลองใหม่");
  }

  const conflict = conflictingDevices?.[0] ?? null;
  if (conflict) {
    return jsonError(
      409,
      "android_install_id_conflict",
      `Android POS เครื่องนี้ถูกจับคู่กับ ${conflict.device_code} อยู่แล้ว กรุณายกเลิกการจับคู่เครื่องเดิมก่อน`
    );
  }

  // Let the existing, fully validated selection/session flow decide first. We
  // only persist the native pairing after device selection succeeds.
  const response = await selectDevice(forwardedRequest);
  if (!response.ok) return response;

  const { data: currentDevice, error: currentDeviceError } = await supabase
    .from("branch_devices")
    .select("id,device_code,metadata")
    .eq("id", device.id)
    .eq("tenant_id", flow.tenantId)
    .eq("branch_id", flow.branchId)
    .single<PairingDeviceRow>();

  if (currentDeviceError || !currentDevice) {
    console.error("[auth/devices/select] android pairing refresh failed", {
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      deviceCode: selectedDeviceCode,
      error: currentDeviceError?.message ?? "device_not_found"
    });
    response.headers.set("x-cpipos-android-pairing", "failed");
    return response;
  }

  const now = new Date().toISOString();
  const currentMetadata = asRecord(currentDevice.metadata);
  const previousInstallId = String(currentMetadata.android_mdm_install_id ?? "").trim();
  const nextMetadata: JsonRecord = {
    ...currentMetadata,
    android_mdm_install_id: installId,
    android_mdm_app_version: appVersion,
    android_mdm_pair_source: "authenticated_device_select",
    android_mdm_last_pair_confirmed_at: now
  };
  if (previousInstallId !== installId || !currentMetadata.android_mdm_paired_at) {
    nextMetadata.android_mdm_paired_at = now;
  }

  const { error: pairingError } = await supabase
    .from("branch_devices")
    .update({
      metadata: nextMetadata,
      last_seen_at: now,
      updated_at: now
    })
    .eq("id", currentDevice.id)
    .eq("tenant_id", flow.tenantId)
    .eq("branch_id", flow.branchId);

  if (pairingError) {
    console.error("[auth/devices/select] android pairing update failed", {
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      deviceCode: selectedDeviceCode,
      installId,
      error: pairingError.message
    });
    response.headers.set("x-cpipos-android-pairing", "failed");
    return response;
  }

  response.headers.set("x-cpipos-android-pairing", previousInstallId === installId ? "confirmed" : "paired");
  return response;
}
