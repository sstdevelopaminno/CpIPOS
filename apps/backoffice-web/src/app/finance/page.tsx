import { requireAccountantPage } from "@/lib/server/accountant-page-guard";
import { FinanceSalesDashboard } from "@/components/finance/finance-sales-dashboard";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  await requireAccountantPage("main.finance");
  return (
    <section className="w-full min-w-0 text-slate-900">
      <FinanceSalesDashboard actor="accountant" />
    </section>
  );
}
