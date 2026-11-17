import { notFound } from "next/navigation";
import { FinanceSalesDashboard } from "@/components/finance/finance-sales-dashboard";
import { hasFinancePackageAccess } from "@/lib/server/finance-package-access";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";

export const dynamic = "force-dynamic";

export default async function OwnerFinancePage() {
  const scope = await requirePosSession();
  if (String(scope.session.role).toLowerCase() !== "owner") notFound();
  if (!await hasFinancePackageAccess(scope.session.tenant_id)) notFound();
  const overrides = await getTenantPosMenuOverrides(scope.session.tenant_id);
  if (overrides["main.finance"] === false) notFound();

  return (
    <section className="h-full w-full overflow-y-auto bg-slate-50 p-4 text-slate-900 md:p-7">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold text-blue-700">CpiPOS · Finance · READ ONLY</p>
          <h1 className="mt-2 text-2xl font-extrabold">การเงิน</h1>
          <p className="mt-2 text-sm text-slate-600">
            เจ้าของร้านเข้าสู่ระบบตามขั้นตอน POS เดิม · ตรวจสอบรายรับจากการขายของสาขาที่ได้รับสิทธิ์ โดยไม่แก้ไขรายการ
          </p>
        </header>
        <FinanceSalesDashboard actor="owner" />
      </div>
    </section>
  );
}
