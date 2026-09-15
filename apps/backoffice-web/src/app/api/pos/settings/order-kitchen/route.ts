import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
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
    const { searchParams } = new URL(request.url);
    const branchId = String(searchParams.get("branch_id") ?? auth.branchId ?? "").trim();
    const policy = await loadTableQrAutomationPolicy(auth, branchId);
    return ok({ policy });
  } catch (error) {
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    const body = (await request.json().catch(() => ({}))) as SaveStoreTableQrAutomationPolicyInput;
    const policy = await saveStoreTableQrAutomationPolicy(auth, body);
    return ok({ policy });
  } catch (error) {
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
