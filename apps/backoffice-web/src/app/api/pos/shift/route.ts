import { after } from "next/server";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession, type PosSessionScope } from "@/lib/pos-session-guard";
import { queueRoutedShiftReport } from "@/lib/printing/routed-print-service";
import { executeShiftClose } from "@/lib/services/shift-close-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";

type PosShiftPayload =
  | { action: "open"; opening_cash: number }
  | {
      action: "close";
      shift_id: string;
      expected_cash: number;
      actual_cash: number;
      manager_override_approval_id?: string;
    };

function normalizeBranchRole(role: string): AuthContext["branchRole"] {
  if (role === "owner" || role === "manager" || role === "staff" || role === "accountant") return role;
  return "staff";
}

function toAuthContext(scope: PosSessionScope): AuthContext {
  return {
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: normalizeBranchRole(scope.session.role),
    platformRole: "tenant_user"
  };
}

export async function GET() {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "shift:join");
    await requireTenantFeature(scope.session.tenant_id, "attendance_tracking", scope.session.branch_id);
    const auth = toAuthContext(scope);
    const supabase = getSupabaseServiceClient();

    const { data: shiftRows, error: shiftError } = await supabase
      .from("shifts")
      .select("id,status,opening_cash,expected_cash,actual_cash,opened_at,closed_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .order("opened_at", { ascending: false })
      .limit(1);

    if (shiftError) {
      return fail("shift_query_failed", shiftError.message, 500);
    }

    const currentShift = shiftRows?.[0] ?? null;
    let queuedOrders = 0;

    if (currentShift?.id) {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("shift_id", currentShift.id)
        .eq("status", "queued");
      queuedOrders = count ?? 0;
    }

    return ok({
      current_shift: currentShift,
      queued_orders: queuedOrders
    });
  } catch (error) {
    if (error instanceof FeatureGateError) {
      return fail(error.code, error.message, error.status);
    }
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requirePosSession();
    const auth = toAuthContext(scope);
    const supabase = getSupabaseServiceClient();
    const body = (await req.json()) as PosShiftPayload;

    if (body.action === "open") {
      requirePermission(scope, "shift:open");
      const openingCash = Number(body.opening_cash ?? 0);
      if (Number.isNaN(openingCash) || openingCash < 0) {
        return fail("invalid_opening_cash", "Opening cash must be zero or positive.", 422);
      }

      const { data: existingOpenShift } = await supabase
        .from("shifts")
        .select("id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();

      if (existingOpenShift) {
        return fail("shift_already_open", "There is already an open shift for this branch.", 409);
      }

      const { data, error } = await supabase
        .from("shifts")
        .insert({
          tenant_id: auth.tenantId,
          branch_id: auth.branchId,
          opened_by: auth.userId,
          opening_cash: openingCash,
          status: "open"
        })
        .select("id,opened_at,status,opening_cash")
        .single();

      if (error) {
        return fail("shift_open_failed", error.message, 500);
      }

      return ok(data, 201);
    }

    requirePermission(scope, "shift:close");
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
      input: body,
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
        close_override_approval_id: body.manager_override_approval_id ?? null,
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

    after(async () => {
      try {
        await queueRoutedShiftReport({
          auth,
          shiftId: body.shift_id,
          runtimeDeviceCode: scope.session.device_code
        });
      } catch (printError) {
        console.error("shift_close_report_print_failed", {
          tenant_id: auth.tenantId,
          branch_id: auth.branchId,
          shift_id: body.shift_id,
          runtime_device_code: scope.session.device_code,
          error: printError instanceof Error ? printError.message : "unknown"
        });
      }
    });

    return ok(result.data);
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("pos_shift_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}
