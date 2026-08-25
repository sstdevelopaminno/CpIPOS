import { PosTaxInvoicesWorkspace } from "@/components/pos-preview/pos-tax-invoices-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosTaxInvoicesPage() {
  await requirePosPagePermission("receipts:view");
  const lang = await getCurrentLanguage();
  return <PosTaxInvoicesWorkspace lang={lang} />;
}
