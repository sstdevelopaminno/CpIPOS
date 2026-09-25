import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { loadPosPackageOverview } from "@/lib/services/pos-package-overview-service";

type ContractRecord = {
  id: string; started_at: string | null; ended_at: string | null;
  billing_interval: string; status: string; package_id: string;
};
type LifecycleRecord = {
  subscription_expires_at: string | null;
  trial_expires_at: string | null;
  lifecycle_status: string;
  access_locked: boolean;
};
type PackageRecord = {
  id: string; code: string; name: string;
  quota_mode: string | null;
};
type PaymentRequestRecord = {
  id: string; request_type: string; status: string; amount_reported: number | null;
  currency: string; submitted_at: string; reviewed_at: string | null;
  review_note: string | null; evidence_url: string | null;
};
type BillingCycleRecord = {
  id: string; period_start: string; period_end: string; amount_due: number;
  amount_paid: number; status: string;
};
type CompanyRecord = {
  billing_legal_name_th: string; billing_bank_name: string;
  billing_bank_account_name: string; billing_bank_account_number: string;
  billing_promptpay_id: string; billing_email: string; support_email: string;
};

export type PosSubscriptionWorkspace = {
  storeCode: string;
  storeName: string;
  packageCode: string | null;
  packageName: string | null;
  quotaMode: string | null;
  status: string;
  billingInterval: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  amountPerCycle: number | null;
  currency: string;
  maxBranches: number | null;
  maxDevices: number | null;
  maxUsers: number | null;
  canManage: boolean;
  company: CompanyRecord | null;
  requests: Array<Omit<PaymentRequestRecord, "evidence_url"> & { has_evidence: boolean }>;
  cycles: BillingCycleRecord[];
};

export async function loadPosSubscriptionWorkspace(
  tenantId: string,
  role: string
): Promise<PosSubscriptionWorkspace> {
  const primary = getPrimarySupabaseServiceClient();
  const canManage = role === "owner" || role === "manager";
  const [overview, contractResult, lifecycleResult, requestsResult, cyclesResult, companyResult] = await Promise.all([
    loadPosPackageOverview(tenantId),
    primary.from("tenant_subscription_contracts")
      .select("id,started_at,ended_at,billing_interval,status,package_id")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false })
      .limit(1).maybeSingle<ContractRecord>(),
    primary.from("tenant_data_lifecycle")
      .select("subscription_expires_at,trial_expires_at,lifecycle_status,access_locked")
      .eq("tenant_id", tenantId).maybeSingle<LifecycleRecord>(),
    canManage ? primary.from("tenant_subscription_payment_requests")
      .select("id,request_type,status,amount_reported,currency,submitted_at,reviewed_at,review_note,evidence_url")
      .eq("tenant_id", tenantId).order("submitted_at", { ascending: false })
      .limit(30).returns<PaymentRequestRecord[]>()
      : Promise.resolve({ data: [] as PaymentRequestRecord[], error: null }),
    canManage ? primary.from("tenant_billing_cycles")
      .select("id,period_start,period_end,amount_due,amount_paid,status")
      .eq("tenant_id", tenantId).order("period_start", { ascending: false })
      .limit(30).returns<BillingCycleRecord[]>()
      : Promise.resolve({ data: [] as BillingCycleRecord[], error: null }),
    canManage ? primary.from("it_communication_settings")
      .select("billing_legal_name_th,billing_bank_name,billing_bank_account_name,billing_bank_account_number,billing_promptpay_id,billing_email,support_email")
      .eq("id", "default").maybeSingle<CompanyRecord>()
      : Promise.resolve({ data: null as CompanyRecord | null, error: null })
  ]);
  if (contractResult.error || lifecycleResult.error || requestsResult.error || cyclesResult.error || companyResult.error) {
    throw new Error("Cannot load the current subscription details.");
  }
  const contract = contractResult.data;
  const lifecycle = lifecycleResult.data;
  const packageId = contract?.package_id;
  const pkgResult = packageId
    ? await primary.from("subscription_packages").select("id,code,name,quota_mode")
      .eq("id", packageId).maybeSingle<PackageRecord>()
    : { data: null as PackageRecord | null, error: null };
  if (pkgResult.error) throw new Error("Cannot load subscription package.");
  const status = lifecycle?.access_locked ? "locked" : contract?.status ?? lifecycle?.lifecycle_status ?? "no_contract";
  const expiresAt = contract?.ended_at
    ?? (contract?.status === "trial" ? lifecycle?.trial_expires_at : lifecycle?.subscription_expires_at)
    ?? null;
  const timestamp = expiresAt ? Date.parse(expiresAt) : NaN;
  const daysRemaining = Number.isFinite(timestamp)
    ? Math.ceil((timestamp - Date.now()) / 86_400_000)
    : null;

  return {
    ...overview,
    quotaMode: pkgResult.data?.quota_mode ?? null,
    status,
    startedAt: contract?.started_at ?? null,
    expiresAt,
    daysRemaining,
    canManage,
    company: companyResult.data ?? null,
    requests: (requestsResult.data ?? []).map(({ evidence_url, ...item }) => ({
      ...item, has_evidence: Boolean(evidence_url)
    })),
    cycles: cyclesResult.data ?? []
  };
}
