import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting } from "@/lib/server/rate-limit";
import { normalizeStoreCodeLookup, resolveTenantByStoreCode } from "@/lib/server/tenant-store-code";

type BranchPolicyRow = {
  branch_id: string;
  max_devices: number | null;
  allow_shared_devices: boolean | null;
  require_registered_device: boolean | null;
  allow_pin_login: boolean | null;
  allow_staff_card_login: boolean | null;
};

type BranchRow = {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean | null;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { store_code?: string } | null;
  const normalizedStoreCode = normalizeStoreCodeLookup(body?.store_code);
  const storeCode = normalizedStoreCode.value;
  if (!storeCode) {
    return Response.json({ data: null, error: { code: "store_code_required", message: "store_code is required." } }, { status: 400 });
  }

  const rateLimitMax = readRateLimitSetting("POS_STORE_RESOLVE_RATE_LIMIT_MAX", 30, { min: 5, max: 500 });
  const rateLimitWindowSeconds = readRateLimitSetting("POS_PUBLIC_RATE_LIMIT_WINDOW_SECONDS", 60, { min: 10, max: 3_600 });
  const rateLimitResult = await enforceRateLimit({
    namespace: "store_resolve",
    key: buildRateLimitKey({
      namespace: "store:resolve",
      parts: [getClientIpAddress(request), storeCode]
    }),
    max: rateLimitMax,
    windowMs: rateLimitWindowSeconds * 1000
  });
  if (!rateLimitResult.ok) {
    console.warn("[store-resolve] Rate limit exceeded", {
      ipAddress: getClientIpAddress(request),
      storeCode,
      retryAfterSeconds: rateLimitResult.retryAfterSeconds
    });
    const limited = Response.json(
      { data: null, error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 }
    );
    limited.headers.set("Retry-After", String(rateLimitResult.retryAfterSeconds));
    return limited;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const resolvedTenant = await resolveTenantByStoreCode(storeCode);
    if (!resolvedTenant || resolvedTenant.isActive === false) {
      return Response.json({ data: null, error: { code: "store_not_found", message: "Store code not found or inactive." } }, { status: 404 });
    }

    const { data: branchRows, error: branchError } = await supabase
      .from("branches")
      .select("id,code,name,is_active")
      .eq("tenant_id", resolvedTenant.tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (branchError) {
      console.error("[store-resolve] Branch lookup failed", { tenantId: resolvedTenant.tenantId, error: branchError.message });
      return Response.json({ data: null, error: { code: "store_lookup_failed", message: "Unable to resolve store at this time." } }, { status: 500 });
    }

    const normalizedBranchRows = (branchRows ?? []) as BranchRow[];
    const branchIds = normalizedBranchRows.map((row) => String(row.id ?? "")).filter(Boolean);
    let policyRows: BranchPolicyRow[] = [];
    if (branchIds.length > 0) {
      const { data, error } = await supabase
        .from("branch_login_policies")
        .select("branch_id,max_devices,allow_shared_devices,require_registered_device,allow_pin_login,allow_staff_card_login")
        .eq("tenant_id", resolvedTenant.tenantId)
        .in("branch_id", branchIds);
      if (!error) {
        policyRows = (data ?? []) as BranchPolicyRow[];
      }
    }

    const policyMap = new Map(policyRows.map((row) => [String(row.branch_id), row]));

    const deviceCountByBranch = new Map<string, number>();
    if (branchIds.length > 0) {
      const { data: deviceRows, error } = await supabase
        .from("branch_devices")
        .select("branch_id,status")
        .eq("tenant_id", resolvedTenant.tenantId)
        .in("branch_id", branchIds)
        .eq("status", "active");
      if (!error) {
        for (const row of (deviceRows ?? []) as Array<{ branch_id: string | null }>) {
          const key = String(row.branch_id ?? "");
          if (!key) continue;
          deviceCountByBranch.set(key, (deviceCountByBranch.get(key) ?? 0) + 1);
        }
      }
    }

    const branches = normalizedBranchRows.map((row) => {
      const id = String(row.id ?? "");
      const policy = policyMap.get(id);
      const maxDevices = Number(policy?.max_devices ?? 1);
      return {
        id,
        code: String(row.code ?? id),
        name: String(row.name ?? id),
        login_policy: {
          allow_shared_devices: policy?.allow_shared_devices ?? false,
          require_registered_device: policy?.require_registered_device ?? true,
          allow_pin_login: policy?.allow_pin_login ?? true,
          allow_staff_card_login: policy?.allow_staff_card_login ?? true,
          max_devices: Number.isFinite(maxDevices) && maxDevices > 0 ? maxDevices : 1,
          active_devices: deviceCountByBranch.get(id) ?? 0
        }
      };
    });

    return Response.json({
      data: {
        tenant: {
          id: resolvedTenant.tenantId,
          code: resolvedTenant.publicCode,
          name: resolvedTenant.name
        },
        branches,
        can_direct_access: branches.length === 0
      },
      error: null
    });
  } catch (error) {
    console.error("[store-resolve] Unexpected error", {
      storeCode,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return Response.json(
      { data: null, error: { code: "store_lookup_failed", message: "Unable to resolve store at this time." } },
      { status: 500 }
    );
  }
}
