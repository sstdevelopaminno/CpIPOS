import { NextResponse } from "next/server";
import { clearShiftOpenBills, ShiftOpenBillsBlockedError, type ShiftOpenBillBlocker } from "@/lib/pos-shift-open-bills";
import {
  PosGuardError,
  getTenantBranchScopeFromSession,
  requireActiveShift,
  requirePermission,
  requirePosSessionForShiftClose
} from "@/lib/pos-session-guard";

function formatOpenBillBlocker(blocker: ShiftOpenBillBlocker) {
  const order = blocker.order_no ?? blocker.order_id ?? "unknown order";
  const table = blocker.table_code ?? blocker.table_id ?? "unknown table";
  const total = blocker.total === null || blocker.total === undefined ? null : ` total ${blocker.total}`;
  return `${order} / table ${table} / ${blocker.status}${total ?? ""}`;
}

function openBillsBlockedResponse(error: ShiftOpenBillsBlockedError) {
  const sample = error.blockers.slice(0, 5).map(formatOpenBillBlocker).join(", ");
  const message = `Please pay or explicitly cancel ${error.count} open dine-in bill(s) before closing shift${sample ? `: ${sample}` : ""}.`;
  return NextResponse.json(
    {
      data: null,
      error: {
        code: "shift_has_open_bills",
        message,
        count: error.count,
        blockers: error.blockers
      }
    },
    { status: 409 }
  );
}
function errorResponse(error: unknown) {
  if (error instanceof PosGuardError) {
    return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof ShiftOpenBillsBlockedError) return openBillsBlockedResponse(error);
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
