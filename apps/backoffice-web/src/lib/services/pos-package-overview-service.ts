import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type TenantPackageRow = {
  id: string;
  code: string | null;
  name: string | null;
  display_name?: string | null;
  package_id?: string | null;
};

type ContractRow = {
  id: string;
  package_id: string | null;
  status: string | null;
  billing_interval: string | null;
  amount_per_cycle: number | null;
  currency: string | null;
  max_branches: number | null;
  branch_limit: number | null;
  max_devices: number | null;
  terminal_limit_per_branch: number | null;
  max_users: number | null;
};

type PackageRow = {
  id: string;
  code: string | null;
  name: string | null;
  monthly_price: number | null;
  yearly_price: number | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
};

export type PosPackageOverview = {
  storeCode: string;
  storeName: string;
  packageCode: string | null;
  packageName: string | null;
  contractStatus: string | null;
  billingInterval: string | null;
  amountPerCycle: number | null;
  currency: string;
  maxBranches: number | null;
  maxDevices: number | null;
  maxUsers: number | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : null;
}

function finiteMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readTenant(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const fullResult = await supabase
    .from("tenants")
    .select("id,code,name,display_name,package_id")
    .eq("id", tenantId)
    .maybeSingle<TenantPackageRow>();

  if (!fullResult.error) return fullResult.data ?? null;

  const legacyResult = await supabase.from("tenants").select("id,code,name").eq("id", tenantId).maybeSingle<TenantPackageRow>();
  if (legacyResult.error) throw new Error(legacyResult.error.message);
  return legacyResult.data ?? null;
}

async function readLatestContract(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_subscription_contracts")
    .select("id,package_id,status,billing_interval,amount_per_cycle,currency,max_branches,branch_limit,max_devices,terminal_limit_per_branch,max_users")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();
  if (error) {
    console.warn("[pos-package-overview] contract lookup failed", { tenantId, error: error.message });
    return null;
  }
  return data ?? null;
}

async function readPackage(packageId: string | null | undefined) {
  const normalized = clean(packageId);
  if (!normalized) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("subscription_packages")
    .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users")
    .eq("id", normalized)
    .maybeSingle<PackageRow>();
  if (error) {
    console.warn("[pos-package-overview] package lookup failed", { packageId: normalized, error: error.message });
    return null;
  }
  return data ?? null;
}

export async function loadPosPackageOverview(tenantId: string): Promise<PosPackageOverview> {
  const [tenant, contract] = await Promise.all([readTenant(tenantId), readLatestContract(tenantId)]);
  const packageRow = await readPackage(contract?.package_id ?? tenant?.package_id ?? null);
  const amountFromPackage = contract?.billing_interval === "yearly" ? packageRow?.yearly_price : packageRow?.monthly_price;

  return {
    storeCode: clean(tenant?.code) || tenantId.slice(0, 8).toUpperCase(),
    storeName: clean(tenant?.display_name) || clean(tenant?.name) || "-",
    packageCode: clean(packageRow?.code) || null,
    packageName: clean(packageRow?.name) || null,
    contractStatus: clean(contract?.status) || null,
    billingInterval: clean(contract?.billing_interval) || null,
    amountPerCycle: finiteMoney(contract?.amount_per_cycle) ?? finiteMoney(amountFromPackage),
    currency: clean(contract?.currency) || "THB",
    maxBranches: positiveInt(contract?.max_branches) ?? positiveInt(contract?.branch_limit) ?? positiveInt(packageRow?.max_branches),
    maxDevices: positiveInt(contract?.max_devices) ?? positiveInt(contract?.terminal_limit_per_branch) ?? positiveInt(packageRow?.max_devices),
    maxUsers: positiveInt(contract?.max_users) ?? positiveInt(packageRow?.max_users)
  };
}
