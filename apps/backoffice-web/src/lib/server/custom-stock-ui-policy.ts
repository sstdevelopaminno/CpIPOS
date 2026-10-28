import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type CustomPosStockMode = "legacy" | "optical" | "retail" | "mixed";

/**
 * The CUSTOM package alone grants no Optical page. Only exactly one current
 * IT-authorized CUSTOM contract with explicit sales_modes may change the UI.
 * Missing/error/ambiguous contracts leave the existing restaurant stock page.
 */
export async function getCustomPosStockUiMode(tenantId: string): Promise<CustomPosStockMode> {
  const db=getSupabaseServiceClient();
  const {data,error}=await db.from("tenant_subscription_contracts")
    .select("package_id,metadata,status,ended_at").eq("tenant_id",tenantId)
    .in("status",["active","trial"]).order("created_at",{ascending:false}).limit(4);
  if(error)return "legacy";
  const now=Date.now();
  const effective=(data??[]).filter(c=>!c.ended_at||Date.parse(c.ended_at)>now);
  if(effective.length!==1)return "legacy";
  const contract=effective[0];
  const {data:plan,error:packageError}=await db.from("subscription_packages")
    .select("code").eq("id",contract.package_id).maybeSingle();
  if(packageError||String(plan?.code??"").toLowerCase()!=="custom")return "legacy";
  const metadata=contract.metadata as Record<string,unknown>|null;
  const modes=(metadata?.sales_modes??{}) as Record<string,unknown>;
  if(!modes||typeof modes!=="object")return "legacy";
  const optical=modes.optical_retail===true;
  const food=["takeaway","dine_in","delivery","buffet_table"].some(x=>modes[x]===true);
  const retail=modes.general_sale===true;
  if(optical&&(food||retail))return "mixed";
  if(optical)return "optical";
  if(retail&&!food)return "retail";
  return "legacy";
}
