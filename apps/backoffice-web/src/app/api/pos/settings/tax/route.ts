import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { loadTaxSettings, saveTaxSettings, type TaxSettingsInput } from "@/lib/services/pos-settings-service";

function statusFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "Tax settings request failed.";
  if (message.includes("Only owner")) return { code: "forbidden_role", message, status: 403 };
  if (message.includes("not found")) return { code: "branch_not_found", message, status: 404 };
  if (message.includes("required")) return { code: "invalid_payload", message, status: 422 };
  return { code: "settings_tax_failed", message, status: 500 };
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "core_pos_sales");
    const { searchParams } = new URL(request.url);
    const branchId = String(searchParams.get("branch_id") ?? auth.branchId ?? "").trim();
    const tax_settings = await loadTaxSettings(auth, branchId);
    return ok({ branch_id: branchId, tax_settings });
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
    const body = (await request.json()) as TaxSettingsInput;
    const tax_settings = await saveTaxSettings(auth, body);
    return ok({ branch_id: String(body.branch_id ?? auth.branchId ?? ""), tax_settings });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
