import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type Lifecycle = {
  lifecycle_status:string;
  access_locked:boolean;
  lock_reason:string|null;
  subscription_expires_at:string|null;
  trial_expires_at:string|null;
  grace_until:string|null;
  metadata:Record<string,unknown>|null;
};
type Contract = {
  package_id:string;
  billing_interval:string;
  amount_per_cycle:number|null;
  currency:string|null;
  status:string;
};
type Package = { id:string; name:string; monthly_price:number|null; yearly_price:number|null };
type Issuer = {
  billing_bank_name:string;
  billing_bank_account_name:string;
  billing_bank_account_number:string;
};

export type PosSubscriptionLifecycleGuardData = {
  tenant_id:string;
  exempt:boolean;
  locked:boolean;
  lock_reason:string|null;
  lifecycle_status:string;
  expires_at:string|null;
  days_remaining:number|null;
  package_name:string;
  billing_interval:"monthly"|"yearly";
  amount_due:number|null;
  currency:string;
  bank_name:string;
  account_name:string;
  account_number:string;
};

type GuardCacheEntry = {
  value: PosSubscriptionLifecycleGuardData | null;
  expiresAt: number;
};

const GUARD_ACTIVE_CACHE_TTL_MS = 5_000;

function getGuardCache() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __posSubscriptionLifecycleGuardCache?: Map<string, GuardCacheEntry>;
  };
  if (!scopedGlobal.__posSubscriptionLifecycleGuardCache) {
    scopedGlobal.__posSubscriptionLifecycleGuardCache = new Map<string, GuardCacheEntry>();
  }
  return scopedGlobal.__posSubscriptionLifecycleGuardCache;
}

function getGuardInFlight() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __posSubscriptionLifecycleGuardInFlight?: Map<string, Promise<PosSubscriptionLifecycleGuardData | null>>;
  };
  if (!scopedGlobal.__posSubscriptionLifecycleGuardInFlight) {
    scopedGlobal.__posSubscriptionLifecycleGuardInFlight = new Map<string, Promise<PosSubscriptionLifecycleGuardData | null>>();
  }
  return scopedGlobal.__posSubscriptionLifecycleGuardInFlight;
}

function readGuardCache(tenantId:string) {
  const cache=getGuardCache();
  const entry=cache.get(tenantId);
  if(!entry) return undefined;
  if(entry.expiresAt<=Date.now()){
    cache.delete(tenantId);
    return undefined;
  }
  return entry.value;
}

function writeGuardCache(tenantId:string,value:PosSubscriptionLifecycleGuardData|null){
  const cache=getGuardCache();
  if(!value || value.locked){
    // Never keep a locked snapshot in process memory. Settlement can unlock a
    // tenant on another Vercel instance at any moment.
    cache.delete(tenantId);
    return;
  }
  const now=Date.now();
  const expiryAt=value.expires_at && Number.isFinite(Date.parse(value.expires_at))
    ? Date.parse(value.expires_at)
    : Number.POSITIVE_INFINITY;
  cache.set(tenantId,{
    value,
    expiresAt:Math.min(now+GUARD_ACTIVE_CACHE_TTL_MS,expiryAt)
  });
}

function moneyValue(value: unknown): number | null {
  const parsed=Number(value);
  return Number.isFinite(parsed) && parsed>0 ? parsed : null;
}

async function loadGuardUncached(tenantId:string):Promise<PosSubscriptionLifecycleGuardData|null>{
  const db=getPrimarySupabaseServiceClient();
  const [life,contract,packages,issuer]=await Promise.all([
    db.from("tenant_data_lifecycle")
      .select("lifecycle_status,access_locked,lock_reason,subscription_expires_at,trial_expires_at,grace_until,metadata")
      .eq("tenant_id",tenantId).maybeSingle<Lifecycle>(),
    db.from("tenant_subscription_contracts")
      .select("package_id,billing_interval,amount_per_cycle,currency,status")
      .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(1).maybeSingle<Contract>(),
    db.from("subscription_packages")
      .select("id,name,monthly_price,yearly_price").eq("is_active",true).limit(50).returns<Package[]>(),
    db.from("it_communication_settings")
      .select("billing_bank_name,billing_bank_account_name,billing_bank_account_number")
      .eq("id","default").maybeSingle<Issuer>()
  ]);
  if (life.error || contract.error || packages.error || issuer.error) return null;
  const lifecycle=life.data;
  const current=contract.data;
  const pkg=(packages.data??[]).find((row)=>row.id===current?.package_id);
  const exempt=lifecycle?.lifecycle_status==="sales_demo" || lifecycle?.metadata?.quota_exempt===true;
  const expiry=exempt ? null : lifecycle?.lifecycle_status==="trial"
    ? lifecycle?.trial_expires_at ?? null
    : lifecycle?.lifecycle_status==="grace"
      ? lifecycle?.grace_until ?? null
      : lifecycle?.subscription_expires_at ?? null;
  const daysRemaining=expiry && Number.isFinite(Date.parse(expiry))
    ? Math.ceil((Date.parse(expiry)-Date.now())/86400000) : null;
  const cycleAmount=moneyValue(current?.amount_per_cycle) ??
    moneyValue(current?.billing_interval==="yearly" ? pkg?.yearly_price : pkg?.monthly_price);
  const locked=Boolean(!exempt && (lifecycle?.access_locked || (expiry && Date.parse(expiry)<=Date.now())));
  return {
    tenant_id:tenantId,
    exempt,
    locked,
    lock_reason:lifecycle?.lock_reason ?? (locked?"subscription_expired":null),
    lifecycle_status:lifecycle?.lifecycle_status ?? current?.status ?? "unknown",
    expires_at:expiry,
    days_remaining:daysRemaining,
    package_name:pkg?.name ?? "แพ็กเกจ",
    billing_interval:current?.billing_interval==="yearly"?"yearly":"monthly",
    amount_due:cycleAmount,
    currency:current?.currency || "THB",
    bank_name:issuer.data?.billing_bank_name ?? "",
    account_name:issuer.data?.billing_bank_account_name ?? "",
    account_number:issuer.data?.billing_bank_account_number ?? ""
  };
}

export async function loadPosSubscriptionLifecycleGuard(
  tenantId:string,
  options?:{forceFresh?:boolean}
):Promise<PosSubscriptionLifecycleGuardData|null>{
  const normalized=tenantId.trim();
  if(!normalized) return null;

  if(options?.forceFresh){
    getGuardCache().delete(normalized);
  }else{
    const cached=readGuardCache(normalized);
    if(cached!==undefined) return cached;
  }

  const inFlight=getGuardInFlight();
  const existing=inFlight.get(normalized);
  if(existing && !options?.forceFresh) return existing;

  const promise=loadGuardUncached(normalized)
    .then((value)=>{
      writeGuardCache(normalized,value);
      return value;
    })
    .finally(()=>inFlight.delete(normalized));

  inFlight.set(normalized,promise);
  return promise;
}
