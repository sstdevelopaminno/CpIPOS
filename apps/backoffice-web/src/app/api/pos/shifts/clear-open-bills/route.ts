import { NextResponse } from "next/server";
import { clearShiftOpenBills } from "@/lib/pos-shift-open-bills";
import {
  PosGuardError,
  getTenantBranchScopeFromSession,
  requireActiveShift,
  requirePermission,
  requirePosSessionForShiftClose
} from "@/lib/pos-session-guard";

function errorResponse(error: unknown) {
  if (error instanceof PosGuardError) {
    return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unable to clear open bills.";
  const [code, detail] = message.includes(": ") ? message.split(/:\s(.+)/, 2) : ["shift_clear_open_bills_failed", message];
  return NextResponse.json({ data: null, error: { code, message: detail ?? message } }, { status: 500 });
}

export async function POST() {
  try {
    const scope = await requirePosSessionForShiftClose();
    requirePermission(scope, "shift:close");
    const { shift } = await requireActiveShift(scope);
    const sessionScope = getTenantBranchScopeFromSession(scope);
    const isStaffRole = scope.session.role !== "owner" && scope.session.role !== "manager" && scope.session.role !== "accountant";

    if (isStaffRole && shift.opened_by !== scope.session.user_id) {
      return NextResponse.json(
        { data: null, error: { code: "shift_clear_open_bills_forbidden", message: "Staff can clear only their own shift bills." } },
        { status: 403 }
      );
    }

    const result = await clearShiftOpenBills({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId,
      shiftId: shift.id,
      userId: sessionScope.userId,
      role: sessionScope.role,
      posSessionId: scope.session.id
    });

    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    return errorResponse(error);
  }
}
