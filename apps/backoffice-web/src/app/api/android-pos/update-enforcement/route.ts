import { NextResponse } from "next/server";
import { ANDROID_MODERN_RELEASE } from "@/lib/android-runtime-release";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type RequestBody = {
  install_id?: unknown;
  version_code?: unknown;
};

type DeviceRow = {
  id: string;
  device_code: string;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

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
    .select("id,device_code,is_active,metadata")
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
  const enforcement = asRecord(device.metadata?.android_update_enforcement);
  if (enforcement.enabled !== true) {
    return NextResponse.json({ required: false, reason: "update_enforcement_not_enabled" }, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const required = versionCode < ANDROID_MODERN_RELEASE.versionCode;
  return NextResponse.json({
    required,
    device_code: device.device_code,
    current_version_code: versionCode,
    target_version_name: ANDROID_MODERN_RELEASE.versionName,
    target_version_code: ANDROID_MODERN_RELEASE.versionCode,
    download_url: ANDROID_MODERN_RELEASE.downloadPath
  }, {
    status: 200,
    headers: { "Cache-Control": "no-store" }
  });
}
