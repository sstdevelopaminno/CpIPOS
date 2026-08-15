import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import {
  loadBranchSalesModeOrderSettings,
  saveBranchSalesModeOrderSettings,
  type SaveBranchSalesModeOrderInput
} from "@/lib/services/pos-sales-mode-order-settings-service";

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

function statusFromError(error: unknown) {
  const candidate = (error ?? {}) as ErrorLike;
  const message = error instanceof Error ? error.message : String(candidate.message ?? "Sales mode settings request failed.");
  const explicitStatus = Number(candidate.status);
  const explicitCode = String(candidate.code ?? "").trim();

  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) {
    return {
      code: explicitCode || "sales_mode_settings_failed",
      message,
      status: explicitStatus
    };
  }
  if (message.includes("Only owner or manager")) return { code: "forbidden_role", message, status: 403 };
  if (message.includes("required") || message.includes("must contain")) return { code: "invalid_payload", message, status: 422 };
  return { code: "sales_mode_settings_failed", message, status: 500 };
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const settings = await loadBranchSalesModeOrderSettings(auth);
    return ok(settings);
  } catch (error) {
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const body = (await request.json()) as SaveBranchSalesModeOrderInput;
    const settings = await saveBranchSalesModeOrderSettings(auth, body);
    return ok(settings);
  } catch (error) {
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
