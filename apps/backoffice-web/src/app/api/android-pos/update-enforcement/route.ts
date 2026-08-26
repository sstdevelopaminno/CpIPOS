import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const TARGET_TENANT_CODE = "FG0003";
const TARGET_DEVICE_CODE = "TEST-POS-01";
const TARGET_VERSION_NAME = "1.0.21";
const TARGET_VERSION_CODE = 29;
const DOWNLOAD_URL = "/download/android/modern-latest";

type RequestBody = {
  install_id?: unknown;
  version_code?: unknown;
};

type DeviceRow = {
  id: string;
  tenant_id: string;
  device_code: string;
  is_active: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const installId = String(body?.install_id ?? "").trim();
  const versionCode = Number(body?.version_code ?? 0);

  if (!installId || installId.length > 120 || !Number.isFinite(versionCode) || versionCode <= 0) {
    return NextResponse.json({ required: false, reason: "invalid_runtime_identity" }, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const supabase = getSupabaseServiceClient();
  const { data: devices, error: deviceError } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,device_code,is_active")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .limit(2)
    .returns<DeviceRow[]>();

  if (deviceError || !devices || devices.length !== 1) {
    return NextResponse.json({ required: false, reason: deviceError ? "device_lookup_failed" : "device_not_uniquely_paired" }, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const device = devices[0];
  if (device.device_code !== TARGET_DEVICE_CODE) {
    return NextResponse.json({ required: false, reason: "device_not_targeted" }, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("code")
    .eq("id", device.tenant_id)
    .maybeSingle<{ code: string }>();

  if (tenantError || tenant?.code !== TARGET_TENANT_CODE) {
    return NextResponse.json({ required: false, reason: "tenant_not_targeted" }, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const required = versionCode < TARGET_VERSION_CODE;
  return NextResponse.json({
    required,
    tenant_code: TARGET_TENANT_CODE,
    device_code: TARGET_DEVICE_CODE,
    current_version_code: versionCode,
    target_version_name: TARGET_VERSION_NAME,
    target_version_code: TARGET_VERSION_CODE,
    download_url: DOWNLOAD_URL
  }, {
    status: 200,
    headers: { "Cache-Control": "no-store" }
  });
}
