import Link from "next/link";

function CardIcon({ kind }: { kind: "billing" | "support" }) {
  const common = { width: 32, height: 32, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "billing") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4M15 15h2" /></svg>;
  return <svg {...common}><path d="M4 14v-2a8 8 0 1 1 16 0v2" /><path d="M4 13H2v5h5v-5H4Zm16 0h2v5h-5v-5h3Z" /><path d="M20 18c0 3-3 4-8 4" /></svg>;
}

export function PosHelpCenter({ canManageBilling }: { canManageBilling: boolean }) {
  const billingCard = <div className="group flex h-full min-h-[220px] flex-col rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_10px_30px_rgba(35,74,132,0.08)] transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-[0_16px_34px_rgba(35,74,132,0.12)]">
    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><CardIcon kind="billing" /></span>
    <div className="mt-5">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-blue-500">PACKAGE & BILLING</p>
      <h2 className="mt-1 text-xl font-black text-[#10213d]">แพ็กเกจและการชำระเงิน</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">ตรวจสอบแพ็กเกจ ต่ออายุ ประวัติ เอกสาร และแจ้งชำระเงินของร้าน</p>
    </div>
    <div className="mt-auto pt-5">
      <span className="inline-flex rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">{canManageBilling ? "เปิดเมนู →" : "เฉพาะ Owner / Manager"}</span>
    </div>
  </div>;

  return <section className="h-full w-full overflow-y-auto bg-[#f7faff] px-4 pb-10 pt-7 sm:px-6 xl:px-8">
    <div className="mx-auto max-w-[1180px]">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><CardIcon kind="support" /></span>
          <div>
            <h1 className="text-[25px] font-black tracking-tight text-[#10213d] sm:text-[30px]">ศูนย์ช่วยเหลือ</h1>
            <p className="mt-1 text-sm text-[#687992]">เลือกบริการที่ต้องการจัดการหรือติดต่อทีม CpIPOS</p>
          </div>
        </div>
      </header>
      <div className="grid gap-5 md:grid-cols-2">
        {canManageBilling ? <Link href="/preview/pos/payments/package" className="block focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2">{billingCard}</Link>
          : <div aria-disabled="true" className="opacity-75">{billingCard}</div>}
        <Link href="/preview/pos/payments/support" className="block focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2">
          <div className="group flex h-full min-h-[220px] flex-col rounded-3xl border border-violet-100 bg-white p-6 shadow-[0_10px_30px_rgba(35,74,132,0.08)] transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-[0_16px_34px_rgba(35,74,132,0.12)]">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><CardIcon kind="support" /></span>
            <div className="mt-5">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-violet-500">CONTACT & SUPPORT</p>
              <h2 className="mt-1 text-xl font-black text-[#10213d]">ติดต่อสอบถาม / แจ้งปัญหา</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">LINE · QR ติดต่อบริษัท และระบบแจ้งปัญหา/แชทกับฝ่าย IT Support</p>
            </div>
            <div className="mt-auto pt-5"><span className="inline-flex rounded-full bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700">เปิดเมนู →</span></div>
          </div>
        </Link>
      </div>
    </div>
  </section>;
}
