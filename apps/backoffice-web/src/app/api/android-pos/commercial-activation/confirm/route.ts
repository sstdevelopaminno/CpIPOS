import { NextResponse } from "next/server";
import { confirmCommercialActivation } from "@/lib/android-pos/commercial-activation";

export const maxDuration = 10;

type JsonRecord = Record<string, unknown>;

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, no-cache, must-revalidate" };
}

function errorResponse(status: number, code: string) {
  return NextResponse.json({ data: null, error: { code } }, { status, headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  if (request.headers.get("x-cpipos-android-pos") !== "true") {
    return errorResponse(403, "android_pos_required");
  }

  const installId = String(request.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120);
  const appVersion = String(request.headers.get("x-cpipos-app-version") ?? "").trim().slice(0, 40) || null;
  if (!installId) return errorResponse(400, "install_id_required");

  const payload = await request.json().catch(() => null) as JsonRecord | null;
  const policyId = String(payload?.policy_id ?? "").trim().slice(0, 180);
  const effectiveDate = String(payload?.effective_date ?? "").trim().slice(0, 10);
  if (!policyId || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return errorResponse(400, "commercial_activation_payload_invalid");
  }

  try {
    const result = await confirmCommercialActivation({
      installId,
      policyId,
      effectiveDate,
      appVersion
    });
    if (!result) return errorResponse(404, "commercial_activation_device_not_found");

    return NextResponse.json({ data: result, error: null }, { headers: noStoreHeaders() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "commercial_activation_failed";
    if (code === "commercial_activation_policy_mismatch") {
      return errorResponse(409, code);
    }
    if (code === "commercial_activation_not_effective") {
      return errorResponse(409, code);
    }
    if (code === "commercial_activation_effective_date_missing") {
      return errorResponse(409, code);
    }
    console.error("[commercial-activation] confirmation failed", { code });
    return errorResponse(500, "commercial_activation_failed");
  }
}
