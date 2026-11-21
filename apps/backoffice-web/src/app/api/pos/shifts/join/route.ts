import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/audit-log";
import {
  PosGuardError,
  getTenantBranchScopeFromSession,
  requirePermission,
  requirePosSession,
  withPosSessionCookie,
  updateCachedPosSessionShift
} from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { recyclingShiftIsToday } from "@/lib/recycling-business-day";

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
    const body = (await request.json().catch(() => null)) as { shift_id?: string; business_mode?: string } | null;
    const shiftId = String(body?.shift_id ?? "").trim();
    if (!shiftId) {
      return NextResponse.json({ data: null, error: { code: "shift_id_required", message: "shift_id is required." } }, { status: 422 });
    }

    const sessionScope = getTenantBranchScopeFromSession(scope);
    const supabase = getSupabaseServiceClient();
    const shiftQuery = await supabase
      .from("shifts")
      .select("id,tenant_id,branch_id,status,device_code,opened_at,opened_by,metadata")
      .eq("id", shiftId)
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId)
      .maybeSingle<{ id: string; tenant_id: string; branch_id: string; status: string; device_code: string | null; opened_at: string; opened_by: string; metadata: Record<string,unknown>|null }>();
    let shiftRow = shiftQuery.data;
    let shiftError = shiftQuery.error;

    if (isMissingShiftDeviceCodeColumnError(shiftQuery.error)) {
      const legacyShiftQuery = await supabase
        .from("shifts")
        .select("id,tenant_id,branch_id,status,opened_at,opened_by,metadata")
        .eq("id", shiftId)
        .eq("tenant_id", sessionScope.tenantId)
        .eq("branch_id", sessionScope.branchId)
        .maybeSingle<{ id: string; tenant_id: string; branch_id: string; status: string; opened_at: string; opened_by: string; metadata: Record<string,unknown>|null }>();
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
    // A recycling cashier cannot join an ordinary POS shift, and the ordinary
    // join endpoint cannot silently bind a tagged Recycling business-day shift.
    const activeMode = shiftRow.metadata?.business_shift_mode;
    const recyclingRequested = body?.business_mode === "recycling";
    const recyclingEnabled = await isAuthorizedRecyclingTenant(sessionScope.tenantId);
    if (recyclingRequested && !recyclingEnabled) {
      return NextResponse.json({data:null,error:{code:"recycling_shift_not_authorized",
        message:"ไม่มีสิทธิ์เข้าร่วมกะ Recycling"}},{status:403});
    }
    if (!recyclingRequested && recyclingEnabled) {
      return NextResponse.json({data:null,error:{code:"recycling_general_shift_disabled",
        message:"ร้าน Recycling ไม่สามารถเข้าร่วมกะ POS ทั่วไปได้จากระบบต่อกะหลัก"}},{status:409});
    }
    if ((recyclingRequested && activeMode !== "recycling_daily") ||
        (!recyclingRequested && activeMode === "recycling_daily")) {
      return NextResponse.json({data:null,error:{code:"recycling_shift_mode_conflict",
        message:"ประเภทกะไม่ตรงกับโหมดของหน้าขาย กรุณาตรวจสอบกับผู้จัดการ"}},{status:409});
    }
    if (recyclingRequested && !recyclingShiftIsToday(shiftRow.opened_at)) {
      return NextResponse.json({data:null,error:{code:"recycling_previous_day_shift_pending_close",
        message:"กะ Recycling จากวันก่อนต้องตรวจสอบและปิดก่อนเข้าร่วมกะใหม่"}},{status:409});
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

    // Keep the cached session consistent with the persisted join binding.
    updateCachedPosSessionShift(scope.session.id, shiftRow.id);

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
