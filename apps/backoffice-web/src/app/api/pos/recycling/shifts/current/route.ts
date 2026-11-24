import { NextResponse } from "next/server";
import { PosGuardError, requirePermission, requirePosSession, withPosSessionCookie } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { recyclingBusinessDayKey, recyclingShiftIsToday } from "@/lib/recycling-business-day";
import { startOfOpticalLocalDateUtc } from "@/lib/pos-optical-daily-shift";

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
      const recoveryEligibleRole = scope.session.role === "owner" || scope.session.role === "manager";
      const legacyCreatedByGate = (row.metadata as Record<string,unknown>|null)?.opened_via === "pos_session_gate";
      return NextResponse.json({
        data:{
          recovery_allowed: recoveryEligibleRole && legacyCreatedByGate,
          legacy_shift_opened_at: row.opened_at
        },
        error:{
          code:"recycling_existing_legacy_shift_requires_review",
          message:recoveryEligibleRole
            ? "มีกะ POS ทั่วไปค้างจากระบบเดิม หากไม่มีธุรกรรมและตรวจนับเงินสดได้ 0.00 บาท สามารถใช้ขั้นตอนกู้คืนกะได้"
            : "มีกะ POS ทั่วไปเปิดค้างอยู่ กรุณาให้เจ้าของร้านหรือผู้จัดการตรวจสอบการกู้คืนกะ Recycling"
        }
      }, { status:409 });
    }
    if (row && !recyclingShiftIsToday(row.opened_at)) {
      return NextResponse.json({ data: null, error: { code: "recycling_previous_day_shift_pending_close", message: "กะเมื่อวานกำลังรอปิดและตรวจสอบยอด กรุณาติดต่อผู้จัดการ" } }, { status: 409 });
    }
    // A closed Recycling shift today blocks opening another shift on this
    // terminal. Return that state to the UI instead of showing a misleading
    // "not opened" form that POST /shifts/open will always reject.
    let closedToday: { id: string; opened_at: string; closed_at: string | null } | null = null;
    if (!row) {
      const today = recyclingBusinessDayKey(new Date());
      const tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 86400000)
        .toISOString().slice(0, 10);
      const from = startOfOpticalLocalDateUtc(today, "Asia/Bangkok");
      const to = startOfOpticalLocalDateUtc(tomorrow, "Asia/Bangkok");
      if (!from || !to) {
        return NextResponse.json({data:null,error:{
          code:"recycling_business_day_unavailable",
          message:"ไม่สามารถตรวจสอบวันทำการของกะได้ กรุณาลองอีกครั้ง"
        }},{status:503});
      }
      let closedQuery = db.from("shifts").select("id,opened_at,closed_at")
        .eq("tenant_id",scope.session.tenant_id)
        .eq("branch_id",scope.session.branch_id)
        .eq("status","closed")
        .gte("opened_at",from.toISOString()).lt("opened_at",to.toISOString())
        .contains("metadata",{business_shift_mode:"recycling_daily"})
        .order("opened_at",{ascending:false}).limit(1);
      closedQuery = scope.session.device_code
        ? closedQuery.eq("device_code",scope.session.device_code)
        : closedQuery.is("device_code",null);
      const closedResult = await closedQuery;
      if (closedResult.error) {
        return NextResponse.json({data:null,error:{
          code:"recycling_shift_daily_review_failed",
          message:"ตรวจสอบประวัติกะที่ปิดวันนี้ไม่สำเร็จ กรุณาลองอีกครั้ง"
        }},{status:503});
      }
      closedToday = closedResult.data?.[0] ?? null;
    }
    const isJoined = row !== null && scope.session.shift_id === row.id;
    const response = NextResponse.json({
      data: {
        shift: row ? {
          id:row.id,status:row.status,opened_at:row.opened_at,opening_cash:row.opening_cash,
          fund_source:typeof (row.metadata as Record<string,unknown>|null)?.recycling_fund_source==="string"
            ? String((row.metadata as Record<string,unknown>).recycling_fund_source):null,
          fund_reference:typeof (row.metadata as Record<string,unknown>|null)?.recycling_fund_reference==="string"
            ? String((row.metadata as Record<string,unknown>).recycling_fund_reference):null
        }:null,
        session_shift_id: scope.session.shift_id,
        closed_today: closedToday,
        needs_join: Boolean(row && !isJoined),
        message: row ? (isJoined ? "กะ Recycling เปิดแล้ว" : "กะเปิดแล้ว แต่ผู้ใช้งานนี้ยังไม่ได้เข้าร่วมกะ")
          : closedToday ? "กะ Recycling วันนี้ปิดแล้ว ไม่สามารถเปิดกะซ้ำได้ กรุณาตรวจสอบประวัติกะ"
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
