import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";
import { resolveOpticalTimeZone, type OpticalCountry, type OpticalCurrency } from "@/lib/pos-optical-daily-shift";

export type OpticalShiftUiPolicy = {
  enabled:boolean;
  country:OpticalCountry|null;
  currency:OpticalCurrency|null;
  timeZone:string|null;
  /** Only when BOTH the server rollout and the tenant's IT feature are enabled. */
  financeEnabled:boolean;
  /** Server-side scheduled daily closure is not yet deployed. */
  automaticClosureReady:false;
};

const disabled:OpticalShiftUiPolicy={
  enabled:false,country:null,currency:null,timeZone:null,financeEnabled:false,automaticClosureReady:false
};

/**
 * IT-controlled policy for CUSTOM Optical. Reading this never changes
 * subscription billing, shift state, financial ledger, or another sales mode.
 */
export async function getOpticalShiftUiPolicy(tenantId:string):Promise<OpticalShiftUiPolicy> {
  const entitled=await requireOpticalRetailEntitlement(tenantId);
  if(!entitled) return disabled;
  const db=getSupabaseServiceClient();
  const {data,error}=await db.from("tenant_subscription_contracts")
    .select("metadata").eq("tenant_id",tenantId).in("status",["active","trial"])
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error||!data) throw new Error("optical_shift_contract_context_unavailable");
  const metadata=(data.metadata??{}) as Record<string,unknown>;
  const currencyRaw=metadata.pos_currency_code;
  const currency:OpticalCurrency|null=
    currencyRaw==="LAK"||currencyRaw==="THB"||currencyRaw==="USD"?currencyRaw:null;
  const explicitCountry=metadata.pos_country_code;
  const country:OpticalCountry|null=
    explicitCountry==="TH"||explicitCountry==="LA"||explicitCountry==="US"
      ? explicitCountry
      : currency==="LAK"?"LA":currency==="THB"?"TH":currency==="USD"?"US":null;
  if(!country||!currency||
    (country==="TH"&&currency!=="THB")||
    (country==="LA"&&currency!=="LAK")||
    (country==="US"&&currency!=="USD")) return disabled;
  const timeZone=resolveOpticalTimeZone(
    country,typeof metadata.pos_timezone==="string"?metadata.pos_timezone:null
  );
  const features=(metadata.custom_features??{}) as Record<string,unknown>;
  // The existing production POS currency/payment flow does not yet support USD.
  const financeEnabled=Boolean(timeZone && country!=="US" &&
    process.env.OPTICAL_FINANCE_V1_ENABLED==="true" &&
    features.optical_deposit===true && features.optical_work_orders===true);
  return {enabled:true,country,currency,timeZone,financeEnabled,automaticClosureReady:false};
}
