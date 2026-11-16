import { redirect } from "next/navigation";
import { requireFinanceSession } from "@/lib/server/finance-session";
import { FinanceLogout } from "./finance-logout";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const identity = await requireFinanceSession();
  if (!identity) redirect("/login/store?from=pos-session");

  return (
    <main className="min-h-screen bg-slate-100 p-5 text-slate-900 md:p-10">
      <section className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-950 p-6 text-white">
          <div>
            <p className="text-xs font-bold tracking-widest text-cyan-300">CpiPOS FINANCE</p>
            <h1 className="mt-2 text-3xl font-bold">การเงิน</h1>
            <p className="mt-2 text-sm text-slate-200">ฝ่ายบัญชี · {identity.name || "พนักงานบัญชี"}</p>
          </div>
          <FinanceLogout />
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-blue-700">ขอบเขตข้อมูล</p>
          <h2 className="mt-2 text-2xl font-bold">ทุกสาขาภายในร้านเดียวกัน</h2>
          <p className="mt-2 text-slate-600">ตรวจพบ {identity.branchIds.length} สาขาที่เปิดใช้งานและได้รับสิทธิ์บัญชีครบถ้วน</p>
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-600">
            <h3 className="font-bold text-slate-800">เตรียมพื้นที่การเงิน</h3>
            <p className="mt-2 text-sm">
              รุ่นนี้เป็นโครงสร้างล็อกอินและการจำกัดสิทธิ์เท่านั้น ยังไม่เปิดดูยอดการเงิน
              บันทึกบัญชี หรือแก้ไขธุรกรรมจริง จนกว่า API และการตรวจสอบข้อมูลทุกสาขาจะผ่านการทดสอบ
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
