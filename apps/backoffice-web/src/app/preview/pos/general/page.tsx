import { notFound } from "next/navigation";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosLegacySalesContent } from "@/components/pos/pos-legacy-sales-content";
import { getCurrentLanguage } from "@/lib/i18n";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";

export const dynamic = "force-dynamic";

/** Ordinary POS remains intact and independently authorized. Enter only
 * after IT grants CUSTOM General Sale; Recycling alone does not grant it. */
export default async function GeneralSaleForCustomPage() {
 const scope = await requirePosSession();
 await assertPosMenuPageAllowed(scope.session.tenant_id,"/preview/pos");
 await requirePosPagePermission("sale:create");
 if (!await isAuthorizedCustomGeneralSaleTenant(scope.session.tenant_id)) notFound();
 const lang = await getCurrentLanguage();
 return <PosLegacySalesContent
   lang={lang}
   tenantId={scope.session.tenant_id}
   branchId={scope.session.branch_id}
   recyclingEnabled={await isAuthorizedRecyclingTenant(scope.session.tenant_id)}/>;
}
