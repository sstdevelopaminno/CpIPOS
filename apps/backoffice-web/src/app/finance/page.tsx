import { RecyclingFinanceDashboard } from "@/components/finance/recycling-finance-dashboard";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { FinanceSalesDashboard } from "@/components/finance/finance-sales-dashboard";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const identity=await requireAccountantPage("main.finance");
  const recycling=await isAuthorizedRecyclingTenant(identity.tenantId);
  return (
    <section className="finance-office-workbench w-full min-w-0 text-slate-900">
      {recycling?<RecyclingFinanceDashboard actor="accountant"/>:<FinanceSalesDashboard actor="accountant" />}
    </section>
  );
}
