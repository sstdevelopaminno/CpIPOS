import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function priceFromMinor(value: unknown): string {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) return "รอตรวจสอบ";
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(n / 100);
}

export default async function RecyclingShiftHistoryPage() {
  const scope = await requirePosSession();
  const { tenant_id: tenantId, branch_id: branchId, role } = scope.session;
  if (!["owner","manager","accountant"].includes(role)) notFound();
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("shifts")
    .select("id,opened_at,closed_at,opening_cash,expected_cash,actual_cash,status,metadata")
    .eq("tenant_id",tenantId).eq("branch_id",branchId)
    .order("opened_at",{ascending:false}).limit(60);
  if (error) throw new Error("recycling_shift_history_unavailable");
  const shifts = (data ?? []).filter(shift => {
    const meta = shift.metadata as Record<string,unknown> | null;
    return meta && typeof meta === "object" &&
      (meta.recycling_buy_count !== undefined || meta.recycling_sell_count !== undefined);
  });
  return <main className="mx-auto max-w-[1300px] space-y-4 px-3 pb-10 pt-4 md:px-6">
    <header className="rounded-xl bg-blue-950 p-5 text-white">
      <p className="text-xs font-bold tracking-widest text-sky-200">CUSTOM · RECYCLING</p>
      <h1 className="mt-1 text-2xl font-extrabold">รายงานเงินสดปิดกะรับซื้อ–ขายออก</h1>
      <p className="mt-1 text-sm text-blue-100">เงินสดรับจากขายออก − เงินสดจ่ายรับซื้อ + เงินสดต้นกะ</p>
      <Link href="/preview/pos/recycling" className="mt-3 inline-block rounded-lg border border-white/30 px-4 py-2 text-sm font-bold">กลับหน้ารับซื้อ–ขายออก</Link>
    </header>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      รายงานนี้แสดงยอดที่ฐานข้อมูลบันทึกเมื่อปิดกะ ไม่ใช่รายการรับโอนธนาคารที่ยืนยันแล้ว และไม่นับเครดิตเป็นเงินสด
      ต้องให้ฝ่ายบัญชีตรวจรายการเงินฝากธนาคาร ลูกหนี้ เจ้าหนี้ และผลต่างเงินสดแยกจากกัน
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1050px] text-sm">
        <thead className="bg-slate-100 text-left text-slate-800">
          <tr>
            <th className="px-3 py-3">วันที่เปิด–ปิดกะ</th>
            <th className="px-3 py-3 text-right">รับซื้อ</th>
            <th className="px-3 py-3 text-right">ขายออก</th>
            <th className="px-3 py-3 text-right">เงินสดต้นกะ</th>
            <th className="px-3 py-3 text-right">เงินสดรับ</th>
            <th className="px-3 py-3 text-right">เงินสดจ่าย</th>
            <th className="px-3 py-3 text-right">คาดว่าคงเหลือ</th>
            <th className="px-3 py-3 text-right">นับได้จริง</th>
            <th className="px-3 py-3">สถานะ</th>
          </tr>
        </thead>
        <tbody>{shifts.length ? shifts.map(shift => {
          const meta = shift.metadata as Record<string,unknown>;
          const expected = Number(shift.expected_cash ?? 0);
          const actual = Number(shift.actual_cash ?? 0);
          const variance = Math.round((actual - expected) * 100);
          return <tr key={shift.id} className="border-t border-slate-100 align-top">
            <td className="px-3 py-3">
              <span className="block font-semibold">{new Date(shift.opened_at).toLocaleDateString("th-TH",{timeZone:"Asia/Bangkok"})}</span>
              <span className="text-xs text-slate-500">{shift.closed_at ? new Date(shift.closed_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}) : "ยังไม่ปิด"}</span>
            </td>
            <td className="px-3 py-3 text-right">{Number(meta.recycling_buy_count ?? 0)}</td>
            <td className="px-3 py-3 text-right">{Number(meta.recycling_sell_count ?? 0)}</td>
            <td className="px-3 py-3 text-right">{Number(shift.opening_cash ?? 0).toFixed(2)}</td>
            <td className="px-3 py-3 text-right font-semibold text-emerald-700">{priceFromMinor(meta.recycling_cash_in_minor)}</td>
            <td className="px-3 py-3 text-right font-semibold text-rose-700">{priceFromMinor(meta.recycling_cash_out_minor)}</td>
            <td className="px-3 py-3 text-right">{Number(shift.expected_cash ?? 0).toFixed(2)}</td>
            <td className="px-3 py-3 text-right">{Number(shift.actual_cash ?? 0).toFixed(2)}</td>
            <td className="px-3 py-3">{shift.status !== "closed" ? "เปิดกะอยู่" : variance===0
              ? <span className="font-semibold text-emerald-700">ยอดตรง</span>
              : <span className="font-semibold text-rose-700">ผลต่าง {priceFromMinor(variance)}</span>}</td>
          </tr>;
        }) : <tr><td colSpan={9} className="px-4 py-14 text-center text-slate-500">
          ยังไม่มีรายงานปิดกะรีไซเคิลที่ผ่านการบันทึกจริง
        </td></tr>}</tbody>
      </table>
    </div>
    <p className="text-xs text-slate-500">
      แสดง 60 กะล่าสุดของสาขาที่เข้าสู่ระบบเท่านั้น หากจำนวนข้อมูลสูงกว่านี้ต้องตรวจจากรายงานแบบแบ่งหน้า
    </p>
  </main>;
}
