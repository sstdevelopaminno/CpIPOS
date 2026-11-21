import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePosSession, requirePermission } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { RecyclingShiftControl, RecyclingShiftPrintButton } from "@/components/pos/recycling-shift-control";

function priceFromMinor(value: unknown): string {
  const n = Number(value);
  if (value === null || value === undefined) return "รอตรวจสอบ";
  if (!Number.isSafeInteger(n)) return "รอตรวจสอบ";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(n / 100);
}

export default async function RecyclingShiftHistoryPageContent({ showGeneralShiftLink = false }: {
  showGeneralShiftLink?: boolean;
} = {}) {
  const scope = await requirePosSession();
  const { tenant_id: tenantId, branch_id: branchId, role } = scope.session;
  // Staff can open/view their own terminal shift; never expose other
  // employees' cash close reports or another branch's financial data.
  requirePermission(scope,"shift:join");
  const canViewBranchHistory=["owner","manager","accountant"].includes(role);
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();
  const db = getSupabaseServiceClient();
  let history=db.from("shifts")
    .select("id,opened_by,device_code,opened_at,closed_at,opening_cash,expected_cash,actual_cash,status,metadata")
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
  return <main className="mx-auto w-full max-w-[1480px] space-y-4 px-3 pb-8 pt-4 md:px-6">
    <header className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wider text-blue-700">CUSTOM · RECYCLING</p>
          <h1 className="mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">เปิด/ปิดกะ · รับซื้อ–ขายออก</h1>
          <p className="mt-1 text-sm text-slate-500">กะประจำวันเฉพาะโหมดค้าของเก่า ไม่เกี่ยวกับกะของ POS แพ็กเกจหลัก</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showGeneralShiftLink && <Link href="/preview/pos/shift?mode=general"
            className="inline-flex min-h-10 items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">
            ดูกะขายทั่วไป
          </Link>}
        <Link href="/preview/pos" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          กลับหน้ารับซื้อ–ขายออก
        </Link>
        </div>
      </div>
    </header>
    <RecyclingShiftControl branchName={scope.branch?.name ?? "สาขาที่เข้าสู่ระบบ"}/>
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
      รายงานนี้แสดงยอดที่ฐานข้อมูลบันทึกเมื่อปิดกะ ไม่ใช่รายการรับโอนธนาคารที่ยืนยันแล้ว และไม่นับเครดิตเป็นเงินสด
      ต้องให้ฝ่ายบัญชีตรวจรายการเงินฝากธนาคาร ลูกหนี้ เจ้าหนี้ และผลต่างเงินสดแยกจากกัน
    </div>
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-base font-extrabold text-slate-900">ประวัติกะ Recycling</h2>
        <span className="text-xs text-slate-500">แสดง {shifts.length} รายการล่าสุดของสาขา</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[1050px] text-sm">
        <thead className="bg-slate-100 text-left text-slate-800">
          <tr>
            <th className="px-3 py-3">วันที่เปิด–ปิดกะ</th>
            <th className="px-3 py-3 text-right">รับซื้อ (บิล)</th>
            <th className="px-3 py-3 text-right">ขายออก (บิล)</th>
            <th className="px-3 py-3 text-right">เงินสดต้นกะ</th>
            <th className="px-3 py-3 text-right">เงินสดรับ</th>
            <th className="px-3 py-3 text-right">เงินสดจ่าย</th>
            <th className="px-3 py-3 text-right">คาดว่าคงเหลือ</th>
            <th className="px-3 py-3 text-right">นับได้จริง</th>
            <th className="px-3 py-3">สถานะ</th>
            <th className="px-3 py-3">ใบสรุป</th>
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
            <td className="px-3 py-3 text-right">{shift.opening_cash===null?"ยังไม่ยืนยัน":Number(shift.opening_cash).toFixed(2)}</td>
            <td className="px-3 py-3 text-right font-semibold text-emerald-700">{priceFromMinor(meta.recycling_cash_in_minor)}</td>
            <td className="px-3 py-3 text-right font-semibold text-rose-700">{priceFromMinor(meta.recycling_cash_out_minor)}</td>
            <td className="px-3 py-3 text-right">{hasExpected?expected.toFixed(2):meta.recycling_expected_cash_minor===null||meta.recycling_expected_cash_minor===undefined?"รอตรวจสอบ":"คาดการณ์ "+priceFromMinor(meta.recycling_expected_cash_minor)}</td>
            <td className="px-3 py-3 text-right">{hasActual?actual.toFixed(2):"รอตรวจนับ"}</td>
            <td className="px-3 py-3">{shift.status !== "closed" ? "เปิดกะอยู่"
              : autoClosed ? <span className="font-semibold text-amber-800">ปิดอัตโนมัติ · รอตรวจนับเงินสด</span>
              : variance===null ? <span className="font-semibold text-amber-800">ปิดแล้ว · ยังไม่ยืนยันยอด</span>
              : variance===0 ? <span className="font-semibold text-emerald-700">ยอดตรง</span>
              : <span className="font-semibold text-rose-700">ผลต่าง {priceFromMinor(variance)}</span>}</td>
            <td className="px-3 py-3">{shift.status==="closed"?<RecyclingShiftPrintButton shiftId={shift.id} automatic={autoClosed}/>: "—"}</td>
          </tr>;
        }) : <tr><td colSpan={10} className="px-4 py-14 text-center text-slate-500">
          ยังไม่มีรายงานปิดกะรีไซเคิลที่ผ่านการบันทึกจริง
        </td></tr>}</tbody>
      </table>
      </div>
    </section>
    <p className="text-xs text-slate-500">
      แสดง 60 กะล่าสุดของสาขาที่เข้าสู่ระบบเท่านั้น หากจำนวนข้อมูลสูงกว่านี้ต้องตรวจจากรายงานแบบแบ่งหน้า
    </p>
  </main>;
}
