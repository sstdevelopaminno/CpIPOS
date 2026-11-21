import { NextResponse } from "next/server";
import { PosGuardError, requirePermission, requirePosSession,
  updateCachedPosSessionShift, withPosSessionCookie } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/**
 * A conscious, manager-confirmed recovery from the old POS 18:00 cycle.
 * The RPC runs as one transaction, checks BOTH shifts and all financial
 * tables and refuses nonzero/unknown drawer cash. GET must never mutate.
 */
export async function POST(request:Request) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"shift:open");
    requirePermission(scope,"shift:close");
    if (!["owner","manager"].includes(scope.session.role)) {
      return NextResponse.json({data:null,error:{
        code:"recycling_recovery_manager_required",
        message:"เฉพาะเจ้าของร้านหรือผู้จัดการเท่านั้นที่สามารถกู้คืนกะที่เปิดผิดได้"
      }},{status:403});
    }
    if (!await isAuthorizedRecyclingTenant(scope.session.tenant_id)) {
      return NextResponse.json({data:null,error:{
        code:"recycling_recovery_not_authorized",
        message:"ต้องมีสิทธิ์ CUSTOM Recycling ที่ยังใช้งานอยู่"
      }},{status:403});
    }
    const body=await request.json().catch(()=>null) as {
      confirmation?:unknown; counted_cash?:unknown
    }|null;
    // Never interpret an absent cash count as zero.
    if (body?.confirmation!=="ยืนยันกู้คืนกะ" ||
        typeof body.counted_cash!=="number" || body.counted_cash!==0) {
      return NextResponse.json({data:null,error:{
        code:"recycling_recovery_zero_cash_confirmation_required",
        message:"ต้องตรวจนับเงินจริงว่าเป็น 0.00 บาท และพิมพ์ ยืนยันกู้คืนกะ ก่อนดำเนินการ"
      }},{status:422});
    }
    const db=getSupabaseServiceClient();
    const {data,error}=await db.rpc("recycling_recover_legacy_shift_v1",{
      p_session_id:scope.session.id,p_confirmed_zero_cash:true
    });
    if(error||!data || typeof data!=="object"||Array.isArray(data)||
        typeof (data as Record<string,unknown>).shift_id!=="string"){
      const reason=String(error?.message??"recycling_recovery_not_available");
      const safeCodes=[
        "recycling_recovery_confirmation_required",
        "recycling_recovery_manager_session_required",
        "recycling_recovery_entitlement_required",
        "recycling_recovery_not_a_zero_float_legacy_shift",
        "recycling_recovery_multiple_open_shifts",
        "recycling_recovery_prior_shift_not_eligible",
        "recycling_recovery_orders_present",
        "recycling_recovery_payments_present",
        "recycling_recovery_transactions_present",
        "recycling_recovery_cash_events_present",
        "recycling_recovery_pending_bills_present",
        "recycling_recovery_concurrent_close",
        "recycling_recovery_session_bind_failed"
      ];
      const known=safeCodes.find(code=>reason.includes(code));
      if(!known)console.error("[recycling-recovery] database recovery rejected",{
        tenant:scope.session.tenant_id,branch:scope.session.branch_id,
        errorCode:error?.code??"unknown",errorMessage:reason
      });
      return NextResponse.json({data:null,error:{
        code:known??"recycling_recovery_unavailable",
        message:known==="recycling_recovery_manager_session_required"
          ?"กรุณาเข้าสู่ระบบใหม่ด้วยสิทธิ์เจ้าของร้านหรือผู้จัดการ"
          :"ไม่สามารถกู้คืนกะได้อย่างปลอดภัย: อาจมียอดเงินสดหรือรายการที่ต้องตรวจสอบ กรุณาติดต่อฝ่าย IT พร้อมตรวจนับเงินสด"
      }},{status:409});
    }
    const shiftId=String((data as Record<string,unknown>).shift_id);
    updateCachedPosSessionShift(scope.session.id,shiftId);
    const response=NextResponse.json({data:{
      shift_id:shiftId,business_shift_mode:"recycling_daily",
      message:"กู้คืนกะ Recycling สำเร็จ พร้อมเริ่มงานในกะใหม่"
    },error:null});
    return withPosSessionCookie(response,scope.session.id);
  }catch(error){
    if(error instanceof PosGuardError){
      return NextResponse.json({data:null,error:{
        code:error.code,message:error.message
      }},{status:error.status});
    }
    console.error("[recycling-recovery] unexpected error",error);
    return NextResponse.json({data:null,error:{
      code:"recycling_recovery_failed",
      message:"ไม่สามารถตรวจสอบกะที่ค้างได้ กรุณาลองใหม่หรือแจ้งฝ่าย IT"
    }},{status:500});
  }
}
