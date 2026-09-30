import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/audit-log";
import {
  PosGuardError,
  getTenantBranchScopeFromSession,
  requirePermission,
  requirePosSession,
  withPosSessionCookie
} from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

function isMissingSessionShiftColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("pos_sessions.shift_id") || message.includes("column shift_id")) return true;
  return message.includes("could not find the 'shift_id' column");
}

function isMissingShiftDeviceCodeColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("shifts.device_code") || message.includes("column device_code")) return true;
  return message.includes("could not find the 'device_code' column");
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "shift:join");
    const body = (await request.json().catch(() => null)) as { shift_id?: string } | null;
    const shiftId = String(body?.shift_id ?? "").trim();
    if (!shiftId) {
      return NextResponse.json({ data: null, error: { code: "shift_id_required", message: "shift_id is required." } }, { status: 422 });
    }

    const sessionScope = getTenantBranchScopeFromSession(scope);
    const supabase = getSupabaseServiceClient();
    const shiftQuery = await supabase
      .from("shifts")
      .select("id,tenant_id,branch_id,status,device_code,opened_at,opened_by")
      .eq("id", shiftId)
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId)
      .maybeSingle<{ id: string; tenant_id: string; branch_id: string; status: string; device_code: string | null; opened_at: string; opened_by: string }>();
    let shiftRow = shiftQuery.data;
    let shiftError = shiftQuery.error;

    if (isMissingShiftDeviceCodeColumnError(shiftQuery.error)) {
      const legacyShiftQuery = await supabase
        .from("shifts")
        .select("id,tenant_id,branch_id,status,opened_at,opened_by")
        .eq("id", shiftId)
        .eq("tenant_id", sessionScope.tenantId)
        .eq("branch_id", sessionScope.branchId)
        .maybeSingle<{ id: string; tenant_id: string; branch_id: string; status: string; opened_at: string; opened_by: string }>();
      shiftRow = legacyShiftQuery.data ? { ...legacyShiftQuery.data, device_code: null } : null;
      shiftError = legacyShiftQuery.error;
    }

    if (shiftError) {
      return NextResponse.json({ data: null, error: { code: "shift_query_failed", message: shiftError.message } }, { status: 500 });
    }
    if (!shiftRow) {
      return NextResponse.json({ data: null, error: { code: "shift_not_found", message: "Shift not found in this scope." } }, { status: 404 });
    }
    if (shiftRow.status !== "open") {
      return NextResponse.json({ data: null, error: { code: "shift_not_open", message: "Shift is not open." } }, { status: 409 });
    }
    const isStaffRole = scope.session.role !== "owner" && scope.session.role !== "manager" && scope.session.role !== "accountant";
    if (isStaffRole && shiftRow.opened_by !== sessionScope.userId) {
      return NextResponse.json(
        { data: null, error: { code: "shift_join_forbidden", message: "Staff can join only their own shift." } },
        { status: 403 }
      );
    }
    if (sessionScope.deviceCode && shiftRow.device_code && sessionScope.deviceCode !== shiftRow.device_code) {
      return NextResponse.json(
        { data: null, error: { code: "device_shift_mismatch", message: "Shift belongs to another device scope." } },
        { status: 409 }
      );
    }

    const { error: sessionUpdateError } = await supabase.from("pos_sessions").update({ shift_id: shiftRow.id }).eq("id", scope.session.id);
    if (sessionUpdateError && !isMissingSessionShiftColumnError(sessionUpdateError)) {
      return NextResponse.json(
        { data: null, error: { code: "session_update_failed", message: sessionUpdateError.message } },
        { status: 500 }
      );
    }

    void appendAuditLog({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId,
      actorUserId: sessionScope.userId,
      actorRole: sessionScope.role as "owner" | "manager" | "staff" | "accountant",
      action: "pos_shift_joined",
      targetTable: "shifts",
      targetId: shiftRow.id,
      metadata: {
        pos_session_id: scope.session.id,
        shift_opened_at: shiftRow.opened_at
      }
    });

    const response = NextResponse.json({
      data: {
        shift: shiftRow,
        session_shift_id: shiftRow.id
      },
      error: null
    });
    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { data: null, error: { code: "pos_shift_join_failed", message: error instanceof Error ? error.message : "Unknown error." } },
      { status: 500 }
    );
  }
}
