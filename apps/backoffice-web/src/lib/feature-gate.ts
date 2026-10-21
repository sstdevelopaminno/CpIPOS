import "server-only";

import { isFeatureUnlockEnabled } from "@/lib/feature-unlock";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getInternalItTestMode } from "@/lib/server/internal-it-test-store";
import { isDineInExplicitlyEnabled, isDineInLinkedFeature, isOpticalRetailExplicitlyEnabled } from "@/lib/pos-sales-modes";

export type QuotaResourceType = "branches" | "devices" | "users";

export type TenantLimits = {
  contractId: string | null;
  planId: string | null;
  contractStatus: string | null;
  maxBranches: number | null;
  maxDevices: number | null;
  maxUsers: number | null;
  usage: {
    branches: number;
    devices: number;
    users: number;
  };
};

type ContractRow = {
  id: string;
  tenant_id: string;
  package_id: string;
  status: string;
  branch_limit: number | null;
  terminal_limit_per_branch: number | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
  metadata: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

type FeatureSubscriptionRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  feature_code: string;
  is_enabled: boolean;
  source: string;
  updated_at: string;
};

type FeatureDecisionCacheEntry = {
  enabled: boolean;
  expiresAt: number;
};

type LatestContractCacheEntry = {
  value: ContractRow | null;
  expiresAt: number;
};

const FEATURE_DECISION_CACHE_TTL_MS = 60_000;
const LATEST_CONTRACT_CACHE_TTL_MS = 60_000;

export class FeatureGateError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "FeatureGateError";
    this.code = code;
    this.status = status;
  }
}

function getFeatureDecisionCache() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __featureDecisionCache?: Map<string, FeatureDecisionCacheEntry>;
  };
  if (!scopedGlobal.__featureDecisionCache) {
    scopedGlobal.__featureDecisionCache = new Map<string, FeatureDecisionCacheEntry>();
  }
  return scopedGlobal.__featureDecisionCache;
}

function getLatestContractCache() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __latestContractCache?: Map<string, LatestContractCacheEntry>;
  };
  if (!scopedGlobal.__latestContractCache) {
    scopedGlobal.__latestContractCache = new Map<string, LatestContractCacheEntry>();
  }
  return scopedGlobal.__latestContractCache;
}

function getLatestContractInFlight() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __latestContractInFlight?: Map<string, Promise<ContractRow | null>>;
  };
  if (!scopedGlobal.__latestContractInFlight) {
    scopedGlobal.__latestContractInFlight = new Map<string, Promise<ContractRow | null>>();
  }
  return scopedGlobal.__latestContractInFlight;
}

function readFeatureDecisionCache(cacheKey: string): boolean | null {
  const cache = getFeatureDecisionCache();
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.enabled;
}

function writeFeatureDecisionCache(cacheKey: string, enabled: boolean) {
  const cache = getFeatureDecisionCache();
  cache.set(cacheKey, {
    enabled,
    expiresAt: Date.now() + FEATURE_DECISION_CACHE_TTL_MS
  });
}

function readLatestContractCache(tenantId: string): ContractRow | null | undefined {
  const cache = getLatestContractCache();
  const entry = cache.get(tenantId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(tenantId);
    return undefined;
  }
  return entry.value;
}

function writeLatestContractCache(tenantId: string, value: ContractRow | null) {
  getLatestContractCache().set(tenantId, {
    value,
    expiresAt: Date.now() + LATEST_CONTRACT_CACHE_TTL_MS
  });
}

export function invalidateTenantFeatureGateCache(tenantId?: string | null) {
  const cache = getFeatureDecisionCache();
  const contractCache = getLatestContractCache();
  const contractInFlight = getLatestContractInFlight();
  if (!tenantId) {
    cache.clear();
    contractCache.clear();
    contractInFlight.clear();
    return;
  }
  const prefix = `${tenantId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  contractCache.delete(tenantId);
  contractInFlight.delete(tenantId);
}

function parseLimit(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : null;
}

function contractAllowsAccess(contract: ContractRow | null): boolean {
  if (!contract) return false;
  if (contract.status !== "active" && contract.status !== "trial") {
    return false;
  }

  if (contract.ended_at) {
    const endMs = new Date(contract.ended_at).getTime();
    if (Number.isFinite(endMs) && endMs <= Date.now()) {
      return false;
    }
  }

  return true;
}

async function getLatestContract(tenantId: string): Promise<ContractRow | null> {
  const cached = readLatestContractCache(tenantId);
  if (cached !== undefined) return cached;

  const inFlight = getLatestContractInFlight();
  const existing = inFlight.get(tenantId);
  if (existing) return existing;

  const supabase = getSupabaseServiceClient();
  const promise = Promise.resolve(
    supabase
      .from("tenant_subscription_contracts")
      .select("id,tenant_id,package_id,status,branch_limit,terminal_limit_per_branch,max_branches,max_devices,max_users,metadata,started_at,ended_at,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ContractRow>()
  )
    .then(({ data, error }) => {
      if (error) {
        throw new FeatureGateError("contract_query_failed", error.message, 500);
      }
      const resolved = data ?? null;
      writeLatestContractCache(tenantId, resolved);
      return resolved;
    })
    .finally(() => {
      inFlight.delete(tenantId);
    });

  inFlight.set(tenantId, promise);
  return promise;
}

export async function hasBranchFeature(tenantId: string, branchId: string | null, featureKey: string): Promise<boolean> {
  const featureCode = String(featureKey).trim();
  if (!tenantId || !featureCode) return false;
  if (isFeatureUnlockEnabled()) return true;
  const normalizedBranchId = branchId || "tenant";
  const cacheKey = `${tenantId}:${normalizedBranchId}:${featureCode}`;
  const cached = readFeatureDecisionCache(cacheKey);
  if (cached !== null) return cached;
  // QA grants affect ONLY the doubly verified internal tenant, not all stores.
  if (await getInternalItTestMode(tenantId) === "full") {
    // QA must never authorize an unknown feature name supplied by a caller.
    const enabled = await isFeatureKeyConfigured(featureCode);
    writeFeatureDecisionCache(cacheKey, enabled);
    return enabled;
  }

  const contract = await getLatestContract(tenantId);
  if (!contractAllowsAccess(contract)) {
    writeFeatureDecisionCache(cacheKey, false);
    return false;
  }

  const supabase = getSupabaseServiceClient();
  const [{ data: planFeatureRow, error: planFeatureError }, { data: tenantOverride, error: tenantOverrideError }, { data: branchOverride, error: branchOverrideError }] = await Promise.all([
    supabase
      .from("subscription_package_features")
      .select("included")
      .eq("package_id", contract?.package_id ?? "")
      .eq("feature_code", featureCode)
      .maybeSingle<{ included: boolean | null }>(),
    supabase
      .from("tenant_feature_subscriptions")
      .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
      .eq("tenant_id", tenantId)
      .eq("feature_code", featureCode)
      .is("branch_id", null)
      .maybeSingle<FeatureSubscriptionRow>(),
    branchId
      ? supabase
          .from("tenant_feature_subscriptions")
          .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
          .eq("tenant_id", tenantId)
          .eq("branch_id", branchId)
          .eq("feature_code", featureCode)
          .maybeSingle<FeatureSubscriptionRow>()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (planFeatureError) {
    throw new FeatureGateError("plan_feature_query_failed", planFeatureError.message, 500);
  }
  if (tenantOverrideError) {
    throw new FeatureGateError("feature_override_query_failed", tenantOverrideError.message, 500);
  }
  if (branchOverrideError) {
    throw new FeatureGateError("branch_feature_override_query_failed", branchOverrideError.message, 500);
  }

  let enabled = Boolean(planFeatureRow?.included);

  if (tenantOverride) {
    enabled = tenantOverride.is_enabled;
  }

  if (branchOverride) {
    enabled = branchOverride.is_enabled;
  }

  // The IT menu switch may grant management access only for the exact
  // authorized CUSTOM Optical tenant. Preserve explicit feature denials and
  // the independent contract quotas for actually creating users/branches.
  const opticalManagementMenu = featureCode === "user_management" ? "settings.users"
    : featureCode === "branch_management" ? "settings.branches"
    : featureCode === "stock_management" ? "more.stock" : null;
  if (!enabled && !tenantOverride && !branchOverride && opticalManagementMenu &&
      isOpticalRetailExplicitlyEnabled(contract?.metadata?.sales_modes)) {
    const [plan, command] = await Promise.all([
      supabase.from("subscription_packages").select("code")
        .eq("id", contract!.package_id).maybeSingle<{ code: string }>(),
      supabase.from("tenant_pos_menu_policies").select("is_enabled")
        .eq("tenant_id", tenantId).eq("menu_key", opticalManagementMenu)
        .maybeSingle<{ is_enabled: boolean }>()
    ]);
    if (plan.error || command.error) throw new FeatureGateError(
      "optical_management_policy_check_failed",
      (plan.error ?? command.error)!.message, 500
    );
    enabled = String(plan.data?.code ?? "").toLowerCase() === "custom" && command.data?.is_enabled === true;
  }

  // An IT-approved CUSTOM Optical contract includes core cashier access.
  // Never override an explicit tenant/branch denial, even for Optical stores.
  // Fixed packages and non-Optical CUSTOM modes retain their own entitlements.
  if (!enabled && !tenantOverride && !branchOverride &&
      (featureCode === "pos.sales.access" || featureCode === "pos_sales" || featureCode === "core_pos_sales") &&
      isOpticalRetailExplicitlyEnabled(contract?.metadata?.sales_modes)) {
    const packageLookup = await supabase.from("subscription_packages")
      .select("code").eq("id", contract!.package_id)
      .maybeSingle<{ code: string }>();
    if (packageLookup.error) throw new FeatureGateError(
      "optical_package_check_failed", packageLookup.error.message, 500
    );
    if (String(packageLookup.data?.code ?? "").toLowerCase() === "custom") enabled = true;
  }

  // Optical retail uses the existing secured SKU/scanner workflow.
  // This additional grant exists ONLY for a CUSTOM contract explicitly
  // enabled by IT; fixed packages retain their normal barcode entitlements.
  if (featureCode === "barcode_scanner_mode" && !enabled
    && isOpticalRetailExplicitlyEnabled(contract?.metadata?.sales_modes)) {
    const currentPackage = await supabase.from("subscription_packages")
      .select("code").eq("id", contract!.package_id)
      .maybeSingle<{ code: string }>();
    if (currentPackage.error) throw new FeatureGateError(
      "optical_package_check_failed", currentPackage.error.message, 500
    );
    if (String(currentPackage.data?.code ?? "").toLowerCase() === "custom") enabled = true;
  }

  // Dine-in cannot operate safely without table, kitchen and table-call
  // notification infrastructure. These are operational dependencies of the
  // selected sales mode, not optional package add-ons. IT menu policy remains
  // the authority for whether the corresponding navigation entry is locked.
  if (isDineInExplicitlyEnabled(contract?.metadata?.sales_modes) && isDineInLinkedFeature(featureCode)) {
    enabled = true;
  }

  writeFeatureDecisionCache(cacheKey, enabled);
  return enabled;
}

export async function hasTenantFeature(tenantId: string, featureKey: string): Promise<boolean> {
  return hasBranchFeature(tenantId, null, featureKey);
}

export async function isFeatureKeyConfigured(featureKey: string): Promise<boolean> {
  const normalized = String(featureKey ?? "").trim();
  if (!normalized) return false;
  if (isFeatureUnlockEnabled()) return true;

  const supabase = getSupabaseServiceClient();
  const [{ count: catalogCount, error: catalogError }, { count: planCount, error: planError }, { count: overrideCount, error: overrideError }] = await Promise.all([
    supabase
      .from("package_feature_catalog")
      .select("code", { count: "exact", head: true })
      .eq("code", normalized),
    supabase
      .from("subscription_package_features")
      .select("feature_code", { count: "exact", head: true })
      .eq("feature_code", normalized),
    supabase
      .from("tenant_feature_subscriptions")
      .select("feature_code", { count: "exact", head: true })
      .eq("feature_code", normalized)
  ]);

  if (catalogError) {
    throw new FeatureGateError("feature_catalog_query_failed", catalogError.message, 500);
  }
  if (planError) {
    throw new FeatureGateError("feature_catalog_query_failed", planError.message, 500);
  }
  if (overrideError) {
    throw new FeatureGateError("feature_catalog_query_failed", overrideError.message, 500);
  }

  return Number(catalogCount ?? 0) > 0 || Number(planCount ?? 0) > 0 || Number(overrideCount ?? 0) > 0;
}

export async function getTenantLimits(tenantId: string): Promise<TenantLimits> {
  const contract = await getLatestContract(tenantId);
  const supabase = getSupabaseServiceClient();

  const [{ count: branchCount, error: branchCountError }, { count: deviceCount, error: deviceCountError }, { data: userRows, error: userRowsError }] = await Promise.all([
    supabase.from("branches").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("branch_devices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active"),
    supabase.from("user_branch_roles").select("user_id").eq("tenant_id", tenantId)
  ]);

  if (branchCountError) {
    throw new FeatureGateError("quota_usage_branches_query_failed", branchCountError.message, 500);
  }
  if (deviceCountError) {
    throw new FeatureGateError("quota_usage_devices_query_failed", deviceCountError.message, 500);
  }
  if (userRowsError) {
    throw new FeatureGateError("quota_usage_users_query_failed", userRowsError.message, 500);
  }

  const metadata = contract?.metadata ?? {};
  const maxBranches = parseLimit(contract?.max_branches) ?? parseLimit(contract?.branch_limit);
  const maxDevices = parseLimit(contract?.max_devices) ?? parseLimit(contract?.terminal_limit_per_branch);
  const maxUsers = parseLimit(contract?.max_users) ?? parseLimit((metadata as { max_users?: unknown }).max_users);

  const users = new Set((userRows ?? []).map((row) => String((row as { user_id?: string }).user_id ?? "")).filter(Boolean));

  return {
    contractId: contract?.id ?? null,
    planId: contract?.package_id ?? null,
    contractStatus: contract?.status ?? null,
    maxBranches,
    maxDevices,
    maxUsers,
    usage: {
      branches: Number(branchCount ?? 0),
      devices: Number(deviceCount ?? 0),
      users: users.size
    }
  };
}

export async function enforceQuota(tenantId: string, resourceType: QuotaResourceType, branchId?: string | null): Promise<TenantLimits> {
  const limits = await getTenantLimits(tenantId);
  if (isFeatureUnlockEnabled() || await getInternalItTestMode(tenantId) === "full") return limits;

  if (limits.contractStatus && limits.contractStatus !== "active" && limits.contractStatus !== "trial") {
    throw new FeatureGateError("contract_suspended", "Tenant contract is not active for provisioning actions.", 403);
  }

  if (resourceType === "branches" && limits.maxBranches !== null && limits.usage.branches >= limits.maxBranches) {
    throw new FeatureGateError("quota_blocked", `Branch quota exceeded (${limits.usage.branches}/${limits.maxBranches}).`, 409);
  }

  if (resourceType === "devices" && limits.maxDevices !== null) {
    // CUSTOM quotas are negotiated per store, not per branch. A two-device
    // CUSTOM contract must never become two devices in EACH branch.
    const supabase = getSupabaseServiceClient();
    const packageResult = await supabase.from("subscription_packages")
      .select("code").eq("id", limits.planId ?? "")
      .maybeSingle<{ code: string }>();
    if (packageResult.error) {
      throw new FeatureGateError("quota_package_lookup_failed", packageResult.error.message, 500);
    }
    const isCustom = String(packageResult.data?.code ?? "").toLowerCase() === "custom";
    let deviceUsage = limits.usage.devices;
    if (branchId && !isCustom) {
      const { count, error } = await supabase
        .from("branch_devices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("status", "active");
      if (error) {
        throw new FeatureGateError("quota_usage_devices_query_failed", error.message, 500);
      }
      deviceUsage = Number(count ?? 0);
    }
    if (deviceUsage >= limits.maxDevices) {
      throw new FeatureGateError("quota_blocked", `Device quota exceeded (${deviceUsage}/${limits.maxDevices}).`, 409);
    }
  }

  if (resourceType === "users" && limits.maxUsers !== null && limits.usage.users >= limits.maxUsers) {
    throw new FeatureGateError("quota_blocked", `User quota exceeded (${limits.usage.users}/${limits.maxUsers}).`, 409);
  }

  return limits;
}

export async function requireTenantFeature(tenantId: string, featureKey: string, branchId?: string | null) {
  const enabled = branchId ? await hasBranchFeature(tenantId, branchId, featureKey) : await hasTenantFeature(tenantId, featureKey);
  if (!enabled) {
    throw new FeatureGateError("feature_not_enabled", `Feature '${featureKey}' is not enabled for this scope.`, 403);
  }
}

export async function requireTenantFeatureIfConfigured(tenantId: string, featureKey: string, branchId?: string | null) {
  const configured = await isFeatureKeyConfigured(featureKey);
  if (!configured) return;
  await requireTenantFeature(tenantId, featureKey, branchId);
}
