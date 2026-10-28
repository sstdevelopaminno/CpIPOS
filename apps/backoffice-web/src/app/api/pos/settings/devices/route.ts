import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import {
  deleteDeviceSettings,
  loadDeviceSettings,
  saveDeviceSettings,
  type PosDeviceInput
} from "@/lib/services/pos-settings-service";

function statusFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "Settings request failed.";
  if (message.includes("Only owner")) return { code: "forbidden_role", message, status: 403 };
  if (message.includes("required")) return { code: "invalid_payload", message, status: 422 };
  if (message.includes("quota") || message.includes("exceeded")) return { code: "device_quota_blocked", message, status: 409 };
  if (message.includes("not found")) return { code: "cashier_device_not_found", message, status: 404 };
  if (message.includes("duplicate key") || message.includes("already exists")) return { code: "cashier_device_duplicate", message, status: 409 };
  return { code: "settings_cashier_device_failed", message, status: 500 };
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "mobile_device_enrollment");
    const devices = await loadDeviceSettings(auth);
    return ok({ devices });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "mobile_device_enrollment");
    const body = (await request.json()) as PosDeviceInput;
    const device = await saveDeviceSettings(auth, body);
    return ok({ device }, 201);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "mobile_device_enrollment");
    const body = (await request.json()) as PosDeviceInput;
    const device = await saveDeviceSettings(auth, body);
    return ok({ device });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "mobile_device_enrollment");
    const { searchParams } = new URL(request.url);
    const result = await deleteDeviceSettings(auth, searchParams.get("device_id") ?? "");
    return ok(result);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
