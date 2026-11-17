import { requireAccountantPage } from "@/lib/server/accountant-page-guard";
import { FinanceSalesDashboard } from "@/components/finance/finance-sales-dashboard";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const identity = await requireAccountantPage("main.finance");
  return (
    <section className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-2xl bg-slate-950 p-6 text-white">
        <p className="text-xs font-bold tracking-widest text-cyan-300">CpiPOS FINANCE · READ ONLY</p>
        <h1 className="mt-2 text-3xl font-bold">การเงิน</h1>
        <p className="mt-2 text-sm text-slate-200">
          ฝ่ายบัญชี · {identity.name ?? "พนักงานบัญชี"} · {identity.branchIds.length} สาขาที่ได้รับสิทธิ์
        </p>
      </header>
      <FinanceSalesDashboard actor="accountant" />
    </section>
  );
}
