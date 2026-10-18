import {notFound,redirect} from "next/navigation";
import {requirePosSession,requirePermission,PosGuardError} from "@/lib/pos-session-guard";
import {assertPosMenuPageAllowed} from "@/lib/server/pos-menu-policy-service";
import {requireOpticalRetailEntitlement} from "@/lib/server/optical-entitlement";
import {PosOpticalWorkOrdersWorkspace} from "@/components/pos/pos-optical-work-orders-workspace";
import {getCurrentLanguage} from "@/lib/i18n";

export default async function PosOpticalWorkOrdersPage(){
  const scope=await requirePosSession();
  try{requirePermission(scope,"sales:list:view");}
  catch(error){if(error instanceof PosGuardError)redirect("/preview/pos");throw error;}
  if(!await requireOpticalRetailEntitlement(scope.session.tenant_id))notFound();
  await assertPosMenuPageAllowed(scope.session.tenant_id,"/preview/pos/optical/work-orders");
  const language=await getCurrentLanguage();
  return <main className="h-full min-h-0 w-full overflow-auto bg-slate-50 p-3 md:p-5">
    <PosOpticalWorkOrdersWorkspace lang={language}/>
  </main>;
}
