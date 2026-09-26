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

function moneyValue(value: unknown): number | null {
  const parsed=Number(value);
  return Number.isFinite(parsed) && parsed>0 ? parsed : null;
}

export async function loadPosSubscriptionLifecycleGuard(tenantId:string) {
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

export type PosSubscriptionLifecycleGuardData = NonNullable<Awaited<ReturnType<typeof loadPosSubscriptionLifecycleGuard>>>;
