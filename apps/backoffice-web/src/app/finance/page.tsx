import { requireAccountantPage } from "@/lib/server/accountant-page-guard";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const identity = await requireAccountantPage("main.finance");
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="rounded-2xl bg-slate-950 p-6 text-white">
        <p className="text-xs font-bold tracking-widest text-cyan-300">CpiPOS FINANCE</p>
        <h1 className="mt-2 text-3xl font-bold">การเงิน</h1>
        <p className="mt-2 text-sm text-slate-200">ฝ่ายบัญชี · {identity.name ?? "พนักงานบัญชี"}</p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">พื้นที่การเงินของร้าน</h2>
        <p className="mt-2 text-slate-600">รองรับสิทธิ์ข้ามสาขาภายในร้านเดียวกัน {identity.branchIds.length} สาขาที่เปิดใช้งาน</p>
        <p className="mt-4 text-sm text-slate-600">
          เลือกเมนู เพิ่มเติม, ตั้งค่า หรือชำระแพ็กเกจจากแถบเมนู
          ขณะนี้เตรียมเส้นทางและสิทธิ์ไว้แล้ว แต่การอ่าน/แก้ไขข้อมูลทางการเงินจริงจะเชื่อมผ่าน API เฉพาะฝ่ายบัญชีในระยะถัดไป
        </p>
      </section>
    </section>
  );
}
