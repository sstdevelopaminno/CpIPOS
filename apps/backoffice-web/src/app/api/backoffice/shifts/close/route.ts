import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { executeShiftClose } from "@/lib/services/shift-close-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const supabase = getSupabaseServiceClient();
    const body = (await req.json()) as {
      shift_id: string;
      expected_cash: number;
      actual_cash: number;
      manager_override_approval_id?: string;
    };
    const overrideApprovalId = body.manager_override_approval_id?.trim();

    if (overrideApprovalId) {
      const { data: approvalRow, error: approvalError } = await supabase
        .from("manager_pin_approvals")
        .select("id,action,expires_at,target_table,target_id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", overrideApprovalId)
        .maybeSingle();

      if (approvalError) {
        return fail("shift_override_approval_query_failed", approvalError.message, 500);
      }
      if (!approvalRow || approvalRow.action !== "shift_close_override") {
        return fail("shift_override_approval_invalid", "Shift close override approval is invalid.", 403);
      }

      const expiresAt = new Date(approvalRow.expires_at).getTime();
      if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
        return fail("shift_override_approval_expired", "Shift close override approval has expired.", 403);
      }
      if (approvalRow.target_id && approvalRow.target_id !== body.shift_id) {
        return fail("shift_override_target_mismatch", "Shift close override approval does not match this shift.", 403);
      }
    }

    const { data: openOrders, error: orderError } = await supabase
      .from("orders")
      .select(
        "id,tenant_id,branch_id,shift_id,order_no,order_type,channel,table_id,external_order_code,customer_name,notes,subtotal,discount_amount,gp_amount,total_amount,status,created_by,cancelled_by,cancelled_reason,created_at"
      )
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("shift_id", body.shift_id);

    if (orderError) {
      return fail("shift_orders_query_failed", orderError.message, 500);
    }

    const result = await executeShiftClose({
      auth,
      input: {
        ...body,
        manager_override_approval_id: overrideApprovalId
      },
      openOrders: openOrders ?? [],
      appendAuditLog
    });

    if (!result.ok) {
      return fail(result.code, result.message, result.status);
    }

    const { error: closeError } = await supabase
      .from("shifts")
      .update({
        expected_cash: body.expected_cash,
        actual_cash: body.actual_cash,
        close_override_approval_id: overrideApprovalId ?? null,
        closed_by: auth.userId,
        closed_at: result.data.closed_at,
        metadata: {
          close_reason: "self_close",
          system_auto_closed: false,
          overdue_auto_close: false,
          auto_close_uses_sales_total: false,
          closed_by_user_id: auth.userId
        },
        status: "closed"
      })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", body.shift_id);

    if (closeError) {
      return fail("shift_close_update_failed", closeError.message, 500);
    }

    return ok(result.data);
  } catch (error) {
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
