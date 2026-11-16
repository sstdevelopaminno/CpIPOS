import { notFound } from "next/navigation";
import { hasFinancePackageAccess } from "@/lib/server/finance-package-access";
import { requirePosSession } from "@/lib/pos-session-guard";

export const dynamic = "force-dynamic";

export default async function OwnerFinancePage() {
  const scope = await requirePosSession();
  if (String(scope.session.role).toLowerCase() !== "owner") notFound();
  if (!await hasFinancePackageAccess(scope.session.tenant_id)) notFound();
  return (
    <section className="h-full w-full overflow-y-auto bg-slate-50 p-4 text-slate-900 md:p-7">
      <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-bold text-blue-700">CpiPOS · Finance</p>
        <h1 className="mt-2 text-2xl font-bold">การเงิน</h1>
        <p className="mt-2 text-slate-600">
          เมนูสำหรับเจ้าของร้านและฝ่ายบัญชี เจ้าของร้านยังใช้ขั้นตอนล็อกอินและระบบ POS แบบเดิม
        </p>
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
          พื้นที่การเงินอยู่ระหว่างพัฒนา ยังไม่มีการอ่านหรือบันทึกธุรกรรมบัญชีจริง
        </div>
      </div>
    </section>
  );
}
