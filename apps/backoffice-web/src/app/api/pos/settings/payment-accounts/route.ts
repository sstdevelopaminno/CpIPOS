import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import {
  deletePaymentAccount,
  loadPosSettingsSnapshot,
  savePaymentAccount,
  type PaymentAccountInput
} from "@/lib/services/pos-settings-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { validateManagerPin } from "@/lib/pin-approval";

function statusFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "Settings request failed.";
  if (message.includes("Only owner")) return { code: "forbidden_role", message, status: 403 };
  if (message.includes("already exists")) return { code: "payment_account_active_duplicate", message, status: 409 };
  if (message.includes("required")) return { code: "invalid_payload", message, status: 422 };
  if (message.includes("not found")) return { code: "payment_account_not_found", message, status: 404 };
  if (message.includes("migration") || message.includes("table is missing")) return { code: "payment_accounts_schema_missing", message, status: 500 };
  return { code: "settings_payment_account_failed", message, status: 500 };
}

async function verifyPaymentAccountDeleteApproval(args: { approvalId: string; tenantId: string; branchId: string; accountId: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("manager_pin_approvals")
    .select("id,action,target_table,target_id,expires_at")
    .eq("id", args.approvalId)
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .maybeSingle<{
      id: string;
      action: string;
      target_table: string;
      target_id: string;
      expires_at: string | null;
    }>();

  if (error) return fail("payment_account_approval_query_failed", error.message, 500);
  if (!data) return fail("payment_account_approval_required", "PIN approval is required to delete payment account.", 403);
  if (data.action !== "payment_account_delete") {
    return fail("payment_account_approval_action_mismatch", "PIN approval action does not match payment account delete.", 403);
  }
  if (data.target_table !== "tenant_payment_accounts" || data.target_id !== args.accountId) {
    return fail("payment_account_approval_target_mismatch", "PIN approval target does not match this payment account.", 403);
  }
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return fail("payment_account_approval_expired", "PIN approval has expired.", 403);
  }
  return null;
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    await requirePosApiFeature(auth, "core_pos_sales");
    const snapshot = await loadPosSettingsSnapshot(auth);
    return ok({
      payment_accounts: snapshot.payment_accounts,
      branches: snapshot.branches,
      metadata: snapshot.metadata
    });
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
    await requirePosApiFeature(auth, "core_pos_sales");
    const body = (await request.json()) as PaymentAccountInput;
    const account = await savePaymentAccount(auth, body);
    return ok({ account }, 201);
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
    const body = (await request.json()) as PaymentAccountInput;
    const account = await savePaymentAccount(auth, body);
    return ok({ account });
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
    await requirePosApiFeature(auth, "core_pos_sales");
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account_id") ?? "";
    const approvalId = String(searchParams.get("approval_id") ?? "").trim();
    const body = await request.json().catch(() => ({})) as { manager_pin?: string };
    const managerPin = String(body.manager_pin ?? "").trim();

    if (approvalId) {
      const approvalError = await verifyPaymentAccountDeleteApproval({
        approvalId,
        tenantId: auth.tenantId!,
        branchId: auth.branchId!,
        accountId
      });
      if (approvalError) return approvalError;
    } else {
      const approval = await validateManagerPin("payment_account_delete", managerPin, {
        tenantId: auth.tenantId!,
        branchId: auth.branchId!
      });
      if (!approval.approved) {
        return fail("pin_rejected", "PIN approval rejected.", 403);
      }
    }

    const result = await deletePaymentAccount(auth, accountId);
    return ok(result);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
