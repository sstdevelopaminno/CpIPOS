import { NextResponse } from "next/server";
import { resolveCommercialActivationGateForInstall } from "@/lib/android-pos/commercial-activation";

export const maxDuration = 10;

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, no-cache, must-revalidate" };
}

function errorResponse(status: number, code: string) {
  return NextResponse.json({ data: null, error: { code } }, { status, headers: noStoreHeaders() });
}

export async function GET(request: Request) {
  if (request.headers.get("x-cpipos-android-pos") !== "true") {
    return errorResponse(403, "android_pos_required");
  }

  const installId = String(request.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120);
  if (!installId) return errorResponse(400, "install_id_required");

  const resolved = await resolveCommercialActivationGateForInstall(installId);
  if (!resolved) return errorResponse(404, "commercial_activation_device_or_policy_not_found");

  return NextResponse.json({
    data: {
      ok: true,
      device_code: resolved.device_code,
      activation_gate: resolved.gate
    },
    error: null
  }, { headers: noStoreHeaders() });
}
