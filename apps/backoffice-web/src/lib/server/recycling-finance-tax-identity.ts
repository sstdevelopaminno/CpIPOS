import "server-only";
import {requireFinanceSession} from "@/lib/server/finance-session";
import {getTenantPosMenuOverrides} from "@/lib/server/pos-menu-policy-service";
import {isAccountantMenuVisible} from "@/lib/accountant-menu-policy";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
export async function recyclingFinanceTaxIdentity(){
 const identity=await requireFinanceSession();
 if(!identity||!identity.branchIds.length||!isAccountantMenuVisible("finance.tax_reports",await getTenantPosMenuOverrides(identity.tenantId))||!await isAuthorizedRecyclingTenant(identity.tenantId))return null;
 return identity;
}
