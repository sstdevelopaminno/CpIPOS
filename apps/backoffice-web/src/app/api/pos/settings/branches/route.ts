import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";
import {
  deactivateBranchSettings,
  loadPosSettingsSnapshot,
  saveBranchSettings,
  type BranchSettingsInput
} from "@/lib/services/pos-settings-service";

async function requireOpticalBranchManagement(tenantId: string, branchId: string | null) {
  if (await requireOpticalRetailEntitlement(tenantId)) {
    await requireTenantFeature(tenantId, "branch_management", branchId);
  }
}

function statusFromError(error: unknown) {
  if (error instanceof FeatureGateError) return { code: error.code, message: error.message, status: error.status };
  const message = error instanceof Error ? error.message : "Settings request failed.";
  if (message.includes("Only owner")) return { code: "forbidden_role", message, status: 403 };
  if (message.includes("required")) return { code: "invalid_payload", message, status: 422 };
  if (message.includes("not found")) return { code: "branch_not_found", message, status: 404 };
  if (message.includes("Current active branch")) return { code: "active_branch_delete_forbidden", message, status: 409 };
  return { code: "settings_branch_failed", message, status: 500 };
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "branch_management");
    const snapshot = await loadPosSettingsSnapshot(auth);
    return ok({ branches: snapshot.branches, metadata: snapshot.metadata });
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
    await requirePosApiFeature(auth, "branch_management");
    await requireOpticalBranchManagement(auth.tenantId!, auth.branchId);
    const body = (await request.json()) as BranchSettingsInput;
    const branch = await saveBranchSettings(auth, body);
    return ok({ branch }, 201);
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
    await requirePosApiFeature(auth, "branch_management");
    await requireOpticalBranchManagement(auth.tenantId!, auth.branchId);
    const body = (await request.json()) as BranchSettingsInput;
    const branch = await saveBranchSettings(auth, body);
    return ok({ branch });
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
    await requirePosApiFeature(auth, "branch_management");
    await requireOpticalBranchManagement(auth.tenantId!, auth.branchId);
    const { searchParams } = new URL(request.url);
    const branch = await deactivateBranchSettings(auth, searchParams.get("branch_id") ?? "");
    return ok({ branch });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
