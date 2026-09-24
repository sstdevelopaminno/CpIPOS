import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { ProductSalesWorkspace } from "@/components/pos-preview/product-sales-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function ProductSalesPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/product-sales");
  const scope = await requirePosPagePermission("sales:list:view");
  const lang = await getCurrentLanguage();
  const role = String(scope.session.role ?? "staff");
  const canViewAllBranches = role === "owner" || role === "manager" || role === "accountant";

  return (
    <ProductSalesWorkspace
      lang={lang}
      canViewAllBranches={canViewAllBranches}
      initialBranchId={scope.session.branch_id}
    />
  );
}
