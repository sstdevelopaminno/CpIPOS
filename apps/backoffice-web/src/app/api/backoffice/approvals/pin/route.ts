import type { PinApprovalInput } from "@pos/shared-types";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { validateManagerPin } from "@/lib/pin-approval";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { executePinApproval } from "@/lib/services/approval-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PinApprovalInput;
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    const supabase = getSupabaseServiceClient();

    const result = await executePinApproval({
      auth,
      input: body,
      validatePin: () =>
        validateManagerPin(body.action, body.manager_pin, {
          tenantId: auth.tenantId!,
          branchId: auth.branchId!
        }),
      appendAuditLog
    });

    if (!result.ok) {
      return fail(result.code, result.message, result.status);
    }

    const { data: approvalRow, error: approvalError } = await supabase
      .from("manager_pin_approvals")
      .insert({
        tenant_id: auth.tenantId,
        branch_id: auth.branchId,
        action: body.action,
        requested_by: auth.userId,
        approved_by: result.data.approved_by,
        target_table: body.target_table,
        target_id: body.target_id,
        note: body.note ?? null
      })
      .select("id,approved_at,expires_at")
      .single();

    if (approvalError) {
      return fail("approval_persistence_failed", approvalError.message, 500);
    }

    return ok({
      ...result.data,
      approval_id: approvalRow.id,
      expires_at: approvalRow.expires_at
    });
  } catch (error) {
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
