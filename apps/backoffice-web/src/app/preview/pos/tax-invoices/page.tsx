import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import Link from "next/link";
import { PosTaxInvoiceWorkspace } from "@/components/pos-preview/pos-tax-invoice-workspace";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { RecyclingTaxInvoiceRegister } from "@/components/pos/recycling-tax-invoice-register";
import type { RecyclingReportQuery } from "@/lib/server/recycling-history-reports";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";

export default async function PosTaxInvoicesPage({searchParams}:{searchParams?:Promise<RecyclingReportQuery & {view?:string}>}) {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/tax-invoices");
  requirePermission(posMenuScope, "receipts:view");
  // Only CUSTOM Recycling uses the new audit-only tax document register.
  // Standard POS tax issuance still exists for non-Recycling packages,
  // but its orders-based API must not issue for recycling_transactions.
  if(await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)){
    const query=await searchParams;
    // The existing buyer and seller registry may be used to prepare verified
    // parties, but Recycling must never invoke the orders-based invoice issue path.
    if(query?.view==="profiles"){
      const lang=await getCurrentLanguage();
      const role=String(posMenuScope.session.role??"staff").toLowerCase();
      return <div className="recycling-tax-register-layout flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto bg-white">
        <nav className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-3">
          <Link href="/preview/pos/tax-invoices" className="inline-flex min-h-10 items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-bold">← กลับรายการขายออก</Link>
        </nav>
        <div className="min-h-0 flex-1"><PosTaxInvoiceWorkspace lang={lang} role={role} registryOnly /></div>
      </div>;
    }
    return <RecyclingTaxInvoiceRegister scope={posMenuScope} search={query}/>;
  }
  const scope = posMenuScope;
  const lang = await getCurrentLanguage();
  const role = String(scope.session.role ?? "staff").toLowerCase();

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-slate-50">
      <div className="px-3 pt-3 sm:px-5 sm:pt-5">
        <Link
          href="/preview/pos/more"
          prefetch={false}
          className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        >
          {lang === "th" ? "← กลับเมนูเพิ่มเติม" : "← Back to More"}
        </Link>
      </div>
      <div className="min-h-0">
        <PosTaxInvoiceWorkspace lang={lang} role={role} />
      </div>
    </div>
  );
}
