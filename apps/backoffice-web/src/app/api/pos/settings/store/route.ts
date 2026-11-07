import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { loadPosSettingsSnapshot, updateStoreSettings, type StoreSettingsInput } from "@/lib/services/pos-settings-service";

function statusFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "Settings request failed.";
  if (message.includes("Only owner")) return { code: "forbidden_role", message, status: 403 };
  if (message.includes("required") || message.includes("logo") || message.includes("image")) return { code: "invalid_payload", message, status: 422 };
  return { code: "settings_store_failed", message, status: 500 };
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "core_pos_sales");
    const snapshot = await loadPosSettingsSnapshot(auth);
    return ok({ store: snapshot.store, metadata: snapshot.metadata });
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
    await requirePosApiFeature(auth, "core_pos_sales");
    const body = (await request.json()) as StoreSettingsInput;
    const store = await updateStoreSettings(auth, body);
    return ok({ store });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
