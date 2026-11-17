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
    <section className="h-full w-full min-w-0 overflow-y-auto bg-slate-50 p-2 text-slate-900 sm:p-3 lg:p-4">
      <FinanceSalesDashboard actor="owner" />
    </section>
  );
}
