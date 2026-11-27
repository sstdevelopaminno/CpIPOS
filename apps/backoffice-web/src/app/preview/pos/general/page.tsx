import { PosSalesPageDenied } from "@/lib/pos-sales-page-denial";
import { PosSalesAccessNotice } from "@/components/pos/pos-sales-access-notice";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { PosLegacySalesContent } from "@/components/pos/pos-legacy-sales-content";
import { getCurrentLanguage } from "@/lib/i18n";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";

export const dynamic = "force-dynamic";

/** Ordinary POS remains intact and independently authorized. Enter only
 * after IT grants CUSTOM General Sale; Recycling alone does not grant it. */
export default async function GeneralSaleForCustomPage() {
 const lang = await getCurrentLanguage();
 const scope = await (async () => {
   try {
     const verified = await requirePosPagePermission("sale:create", "/login/store", true);
     await assertPosMenuPageAllowed(verified.session.tenant_id, "/preview/pos", true);
     if (!await isAuthorizedCustomGeneralSaleTenant(verified.session.tenant_id, verified.session.branch_id)) {
       throw new PosSalesPageDenied("mode");
     }
     return verified;
   } catch (error) {
     if (error instanceof PosSalesPageDenied) return error;
     throw error;
   }
 })();
 if (scope instanceof PosSalesPageDenied) {
   return <PosSalesAccessNotice reason={scope.reason} lang={lang} generalSale />;
 }
 return <PosLegacySalesContent
   lang={lang}
   tenantId={scope.session.tenant_id}
   branchId={scope.session.branch_id}
   recyclingEnabled={await isAuthorizedRecyclingTenant(scope.session.tenant_id)}/>;
}
