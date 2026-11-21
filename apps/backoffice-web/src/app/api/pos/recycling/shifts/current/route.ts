import { NextResponse } from "next/server";
import { PosGuardError, requirePermission, requirePosSession, withPosSessionCookie } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { recyclingShiftIsToday } from "@/lib/recycling-business-day";

// Read-only, branch + terminal scoped check. Never start or join a shift on a GET.
export async function GET() {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "shift:join");
    if (!await isAuthorizedRecyclingTenant(scope.session.tenant_id)) {
      return NextResponse.json({ data: null, error: { code: "recycling_shift_not_authorized", message: "ไม่ได้รับสิทธิ์ CUSTOM Recycling" } }, { status: 403 });
    }
    const db = getSupabaseServiceClient();
    let query = db.from("shifts")
      .select("id,status,opened_at,opening_cash,metadata,device_code")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(20);
    query = scope.session.device_code
      ? query.eq("device_code", scope.session.device_code)
      : query.is("device_code", null);
    const result = await query;
    if (result.error) {
      return NextResponse.json({ data: null, error: { code: "recycling_shift_lookup_failed", message: "ตรวจสอบกะไม่สำเร็จ กรุณาลองอีกครั้ง" } }, { status: 503 });
    }
    const rows = result.data ?? [];
    if (rows.length > 1) {
      return NextResponse.json({ data: null, error: { code: "recycling_shift_conflict", message: "พบกะเปิดมากกว่าหนึ่งรายการในเครื่องนี้ กรุณาติดต่อผู้จัดการ" } }, { status: 409 });
    }
    const row = rows[0] ?? null;
    const mode = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>).business_shift_mode : null;
    if (row && mode !== "recycling_daily") {
      return NextResponse.json({ data: null, error: { code: "recycling_existing_legacy_shift_requires_review", message: "มี POS กะทั่วไปเปิดค้างอยู่ ต้องปิดและตรวจสอบก่อนเปิดกะ Recycling" } }, { status: 409 });
    }
    if (row && !recyclingShiftIsToday(row.opened_at)) {
      return NextResponse.json({ data: null, error: { code: "recycling_previous_day_shift_pending_close", message: "กะเมื่อวานกำลังรอปิดและตรวจสอบยอด กรุณาติดต่อผู้จัดการ" } }, { status: 409 });
    }
    const isJoined = row !== null && scope.session.shift_id === row.id;
    const response = NextResponse.json({
      data: {
        shift: row ? { id: row.id, status: row.status, opened_at: row.opened_at, opening_cash: row.opening_cash } : null,
        session_shift_id: scope.session.shift_id,
        needs_join: Boolean(row && !isJoined),
        message: row ? (isJoined ? "กะ Recycling เปิดแล้ว" : "กะเปิดแล้ว แต่ผู้ใช้งานนี้ยังไม่ได้เข้าร่วมกะ")
          : "ยังไม่ได้เปิดกะวันนี้ กรุณาไปที่เมนูเปิด/ปิดกะ"
      },
      error: null
    });
    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ data: null, error: { code: "recycling_shift_current_failed", message: "ยังไม่สามารถยืนยันสถานะกะได้" } }, { status: 500 });
  }
}
