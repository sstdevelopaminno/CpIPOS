import {RecyclingShiftHistoryActions} from "@/components/pos/recycling-shift-history-actions";
import { formatRecyclingMoney } from "@/lib/recycling-money-display";
import { notFound } from "next/navigation";
import { requirePosSession, requirePermission } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { RecyclingShiftControl, RecyclingShiftPrintButton } from "@/components/pos/recycling-shift-control";

function priceFromMinor(value: unknown): string {
  const n = Number(value);
  if (value === null || value === undefined) return "รอตรวจสอบ";
  if (!Number.isSafeInteger(n)) return "รอตรวจสอบ";
  return formatRecyclingMoney(n / 100, "รอตรวจสอบ");
}

export default async function RecyclingShiftHistoryPageContent() {
  const scope = await requirePosSession();
  const { tenant_id: tenantId, branch_id: branchId, role } = scope.session;
  // Staff can open/view their own terminal shift; never expose other
  // employees' cash close reports or another branch's financial data.
  requirePermission(scope,"shift:join");
  const canManageHistory=["owner","manager"].includes(role);
  const canViewBranchHistory=["owner","manager","accountant"].includes(role);
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();
  const db = getSupabaseServiceClient();
  let history=db.from("shifts")
    .select("id,opened_by,device_code,opened_at,closed_at,opening_cash,expected_cash,actual_cash,status,metadata,updated_at")
    .eq("tenant_id",tenantId).eq("branch_id",branchId);
  if(!canViewBranchHistory){
    history=history.eq("opened_by",scope.session.user_id);
    history=scope.session.device_code
      ?history.eq("device_code",scope.session.device_code)
      :history.is("device_code",null);
  }
  const { data, error } = await history
    .order("opened_at",{ascending:false}).limit(60);
  if (error) throw new Error("recycling_shift_history_unavailable");
  const shifts = (data ?? []).filter(shift => {
    const meta = shift.metadata as Record<string,unknown> | null;
    return meta && typeof meta === "object" &&
      (meta.business_shift_mode === "recycling_daily" || meta.recycling_buy_count !== undefined || meta.recycling_sell_count !== undefined);
  });
  return <main className="recycling-shift-layout flex h-full min-h-0 w-full flex-col overflow-y-auto bg-white" data-testid="recycling-shift-single-container">
    <RecyclingShiftControl branchName={scope.branch?.name ?? "สาขาที่เข้าสู่ระบบ"}/>
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div><h1 className="text-base font-extrabold text-slate-900">ประวัติกะ · เงินทุนหมุนเวียนรับซื้อ</h1>
          <p className="mt-1 text-xs text-slate-500">เงินสดจ่ายรับซื้อเป็นเงินออก · ขายให้โรงงานเพิ่มเงินสดเฉพาะยอดที่รับจริง · ปิดกะด้วยผลนับเงินจริง</p></div>
        <span className="text-xs text-slate-500">แสดง {shifts.length} รายการล่าสุดของสาขา</span>
      </div>
      <div className="min-h-0 w-full flex-1 overflow-x-auto overflow-y-auto">
      <table className="w-full min-w-[1050px] text-sm">
        <thead className="bg-slate-100 text-left text-slate-800">
          <tr>
            <th className="px-3 py-3">วันที่เปิด–ปิดกะ</th>
            <th className="px-3 py-3 text-right">รับซื้อ (บิล)</th>
            <th className="px-3 py-3 text-right">ขายออก (บิล)</th>
            <th className="px-3 py-3 text-right">ทุนเงินสดเปิดกะ</th>
            <th className="px-3 py-3 text-right">ขายออก · เงินสดรับ</th>
            <th className="px-3 py-3 text-right">รับซื้อ · เงินสดจ่าย</th>
            <th className="px-3 py-3 text-right">คงเหลือตามระบบ</th>
            <th className="px-3 py-3 text-right">คงเหลือนับจริง</th>
            <th className="px-3 py-3">สถานะ</th>
            <th className="px-3 py-3">ใบสรุป</th>
            {canManageHistory&&<th className="px-3 py-3">จัดการ</th>}
          </tr>
        </thead>
        <tbody>{shifts.length ? shifts.map(shift => {
          const meta = shift.metadata as Record<string,unknown>;
          const hasExpected=shift.expected_cash!==null && shift.expected_cash!==undefined;
          const hasActual=shift.actual_cash!==null && shift.actual_cash!==undefined;
          const expected=Number(shift.expected_cash??0),actual=Number(shift.actual_cash??0);
          const variance=hasExpected&&hasActual?Math.round((actual-expected)*100):null;
          const autoClosed=meta.close_reason==="recycling_daily_auto_close_midnight";
          return <tr key={shift.id} className="border-t border-slate-100 align-top">
            <td className="px-3 py-3">
              <span className="block font-semibold">{new Date(shift.opened_at).toLocaleDateString("th-TH",{timeZone:"Asia/Bangkok"})}</span>
              <span className="text-xs text-slate-500">{shift.closed_at ? new Date(shift.closed_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}) : "ยังไม่ปิด"}</span>
            </td>
            <td className="px-3 py-3 text-right">{Number(meta.recycling_buy_count ?? 0)}</td>
            <td className="px-3 py-3 text-right">{Number(meta.recycling_sell_count ?? 0)}</td>
            <td className="px-3 py-3 text-right">{shift.opening_cash===null?"ยังไม่ยืนยัน":formatRecyclingMoney(shift.opening_cash, "ยังไม่ยืนยัน")}</td>
            <td className="px-3 py-3 text-right font-semibold text-emerald-700">{priceFromMinor(meta.recycling_cash_in_minor)}</td>
            <td className="px-3 py-3 text-right font-semibold text-rose-700">{priceFromMinor(meta.recycling_cash_out_minor)}</td>
            <td className="px-3 py-3 text-right">{hasExpected?formatRecyclingMoney(expected, "รอตรวจสอบ"):meta.recycling_expected_cash_minor===null||meta.recycling_expected_cash_minor===undefined?"รอตรวจสอบ":"คาดการณ์ "+priceFromMinor(meta.recycling_expected_cash_minor)}</td>
            <td className="px-3 py-3 text-right">{hasActual?formatRecyclingMoney(actual, "รอตรวจนับ"):"รอตรวจนับ"}</td>
            <td className="px-3 py-3">{shift.status !== "closed" ? "เปิดกะอยู่"
              : autoClosed ? <span className="font-semibold text-amber-800">ปิดอัตโนมัติ · รอตรวจนับเงินสด</span>
              : variance===null ? <span className="font-semibold text-amber-800">ปิดแล้ว · ยังไม่ยืนยันยอด</span>
              : variance===0 ? <span className="font-semibold text-emerald-700">ยอดตรง</span>
              : <span className="font-semibold text-rose-700">ผลต่าง {priceFromMinor(variance)}</span>}</td>
            <td className="px-3 py-3">{shift.status==="closed"?<RecyclingShiftPrintButton shiftId={shift.id} automatic={autoClosed}/>: "—"}</td>
            {canManageHistory&&<td className="px-3 py-3">{shift.status==="closed"?<RecyclingShiftHistoryActions key={shift.updated_at} shift={{id:shift.id,opened_at:shift.opened_at,closed_at:shift.closed_at,opening_cash:shift.opening_cash,actual_cash:shift.actual_cash,updated_at:shift.updated_at}}/>:"—"}</td>}
          </tr>;
        }) : <tr><td colSpan={canManageHistory?11:10} className="px-4 py-14 text-center text-slate-500">
          ยังไม่มีรายงานปิดกะรีไซเคิลที่ผ่านการบันทึกจริง
        </td></tr>}</tbody>
      </table>
      </div>
    </section>
    <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
      ยอดรับ–จ่ายในตารางอ้างอิงธุรกรรม Recycling ของกะ ไม่ใช่ยอดเงินฝากธนาคารหรือเงินทุนที่เบิกเพิ่มโดยไม่ได้บันทึก · แสดงไม่เกิน 60 กะล่าสุด
    </p>
  </main>;
}
