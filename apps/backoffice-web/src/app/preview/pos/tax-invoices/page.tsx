import Link from "next/link";
import { PosTaxInvoiceWorkspace } from "@/components/pos-preview/pos-tax-invoice-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";

export default async function PosTaxInvoicesPage() {
  const scope = await requirePosSession();
  requirePermission(scope, "receipts:view");
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
