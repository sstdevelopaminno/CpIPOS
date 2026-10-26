import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { hasBranchFeature } from "@/lib/feature-gate";
import {
  loadTableQrAutomationPolicy,
  saveStoreTableQrAutomationPolicy,
  type SaveStoreTableQrAutomationPolicyInput
} from "@/lib/services/table-qr-automation-policy-service";

function statusFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "Order and kitchen settings request failed.";
  if (message.includes("Only owner or manager") || message.includes("scope mismatch")) {
    return { code: "forbidden_role", message, status: 403 };
  }
  if (message.includes("required")) return { code: "invalid_payload", message, status: 422 };
  return { code: "order_kitchen_settings_failed", message, status: 500 };
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    const [canQrOrdering, canKitchenPrinting] = await Promise.all([
      hasBranchFeature(auth.tenantId!, auth.branchId, "qr_table_ordering"),
      hasBranchFeature(auth.tenantId!, auth.branchId, "kitchen_printing")
    ]);
    if (!canQrOrdering && !canKitchenPrinting) {
      await requirePosApiFeature(auth, "qr_table_ordering");
    }
    const { searchParams } = new URL(request.url);
    const branchId = String(searchParams.get("branch_id") ?? auth.branchId ?? "").trim();
    const policy = await loadTableQrAutomationPolicy(auth, branchId);
    return ok({ policy });
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
    const body = (await request.json().catch(() => ({}))) as SaveStoreTableQrAutomationPolicyInput;
    const wantsQrPolicy =
      typeof body.popup_enabled === "boolean" ||
      typeof body.kitchen_auto_send_enabled === "boolean";
    const wantsKitchenPrint = typeof body.kitchen_auto_print_enabled === "boolean";

    if (wantsQrPolicy) {
      await requirePosApiFeature(auth, "qr_table_ordering");
    }
    // Always permit turning an old value off; enabling print requires the
    // kitchen_printing package entitlement.
    if (body.kitchen_auto_print_enabled === true) {
      await requirePosApiFeature(auth, "kitchen_printing");
    }
    if (!wantsQrPolicy && !wantsKitchenPrint) {
      return fail("invalid_payload", "At least one order/kitchen setting is required.", 422);
    }
    const policy = await saveStoreTableQrAutomationPolicy(auth, body);
    return ok({ policy });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
