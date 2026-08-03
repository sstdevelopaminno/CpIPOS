import { NextResponse } from "next/server";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { PosGuardError, requirePermission, requirePosSession, withPosSessionCookie } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type ShiftRow = {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number | null;
  opened_by: string;
  device_code: string | null;
};
type ShiftRowWithoutDeviceCode = Omit<ShiftRow, "device_code">;

function isMissingShiftDeviceCodeColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("shifts.device_code") || message.includes("column device_code")) return true;
  return message.includes("could not find the 'device_code' column");
}

function withNullDeviceCode(row: ShiftRowWithoutDeviceCode): ShiftRow {
  return {
    ...row,
    device_code: null
  };
}

function pickActiveShift(params: {
  sessionShiftId: string | null;
  deviceCode: string | null;
  rows: ShiftRow[];
}): ShiftRow | null {
  const { sessionShiftId, deviceCode, rows } = params;
  if (sessionShiftId) {
    const match = rows.find((row) => row.id === sessionShiftId);
    if (match) return match;
  }
  if (deviceCode) {
    const deviceShift = rows.find((row) => row.device_code === deviceCode);
    if (deviceShift) return deviceShift;
  }
  return null;
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "shift:join");
    await requireTenantFeature(scope.session.tenant_id, "attendance_tracking", scope.session.branch_id);
    const supabase = getSupabaseServiceClient();

    const currentShiftQuery = await supabase
      .from("shifts")
      .select("id,status,opened_at,closed_at,opening_cash,opened_by,device_code")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(20);
    let rows = currentShiftQuery.data as ShiftRow[] | null;
    let error = currentShiftQuery.error;
    let legacyWithoutDeviceColumn = false;
    if (isMissingShiftDeviceCodeColumnError(error)) {
      legacyWithoutDeviceColumn = true;
      const legacyShiftQuery = await supabase
        .from("shifts")
        .select("id,status,opened_at,closed_at,opening_cash,opened_by")
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(20);
      rows = (legacyShiftQuery.data ?? []).map((row) => withNullDeviceCode(row as ShiftRowWithoutDeviceCode));
      error = legacyShiftQuery.error;
    }

    if (error) {
      console.error("[pos-shifts-current] query failed", {
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        error: error.message
      });
      const response = NextResponse.json(
        { data: null, error: { code: "shifts_current_query_failed", message: `Unable to load current shifts. ${error.message}` } },
        { status: 500 }
      );
      const durationMs = Date.now() - startedAt;
      response.headers.set("x-pos-api-ms", String(durationMs));
      response.headers.set("server-timing", `total;dur=${durationMs}`);
      return response;
    }

    const role = scope.session.role;
    const isStaffRole = role !== "owner" && role !== "manager" && role !== "accountant";
    const openShiftsAll = (rows ?? []) as ShiftRow[];
    const roleScopedShifts = isStaffRole
      ? openShiftsAll.filter((shift) => shift.opened_by === scope.session.user_id)
      : openShiftsAll;

    // In current schema, device_code is the terminal boundary. A cashier terminal must not
    // auto-join another terminal's legacy/shared branch shift because that mixes sales totals
    // and causes one device to appear empty while another device owns all rows.
    const openShifts = legacyWithoutDeviceColumn
      ? roleScopedShifts
      : scope.session.device_code
        ? roleScopedShifts.filter((shift) => shift.device_code === scope.session.device_code)
        : roleScopedShifts.filter((shift) => !shift.device_code);
    const activeShift = pickActiveShift({
      sessionShiftId: scope.session.shift_id,
      deviceCode: scope.session.device_code,
      rows: openShifts
    });

    const response = NextResponse.json({
      data: {
        current_shift: activeShift,
        available_open_shifts: openShifts,
        session_shift_id: scope.session.shift_id
      },
      error: null
    });
    const durationMs = Date.now() - startedAt;
    response.headers.set("x-pos-api-ms", String(durationMs));
    response.headers.set("server-timing", `total;dur=${durationMs}`);
    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof FeatureGateError) {
      const response = NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
      const durationMs = Date.now() - startedAt;
      response.headers.set("x-pos-api-ms", String(durationMs));
      response.headers.set("server-timing", `total;dur=${durationMs}`);
      return response;
    }
    if (error instanceof PosGuardError) {
      const response = NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
      const durationMs = Date.now() - startedAt;
      response.headers.set("x-pos-api-ms", String(durationMs));
      response.headers.set("server-timing", `total;dur=${durationMs}`);
      return response;
    }
    console.error("[pos-shifts-current] unexpected error", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
    const response = NextResponse.json(
      { data: null, error: { code: "pos_shifts_current_failed", message: "Unable to load current shifts." } },
      { status: 500 }
    );
    const durationMs = Date.now() - startedAt;
    response.headers.set("x-pos-api-ms", String(durationMs));
    response.headers.set("server-timing", `total;dur=${durationMs}`);
    return response;
  }
}
