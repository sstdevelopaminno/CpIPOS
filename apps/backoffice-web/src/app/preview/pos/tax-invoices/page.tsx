import { PosTaxInvoiceWorkspace } from "@/components/pos-preview/pos-tax-invoice-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";

export default async function PosTaxInvoicesPage() {
  const scope = await requirePosSession();
  requirePermission(scope, "receipts:view");
  const lang = await getCurrentLanguage();
  const role = String(scope.session.role ?? "staff").toLowerCase();
  return <PosTaxInvoiceWorkspace lang={lang} role={role} />;
}
