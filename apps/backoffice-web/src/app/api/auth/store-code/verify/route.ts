import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getRequestMeta, writeAuditLog } from "@/lib/server/audit-log";
import { AuthTimeoutError, withAuthTimeout } from "@/lib/server/auth-timeout";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting, type RateLimitResult } from "@/lib/server/rate-limit";
import { clearPreEntryFlowState, createFlowState, writePreEntryFlowState } from "@/lib/server/pre-entry-state";
import { resolveSessionCookieConfig } from "@/lib/server/pos-session";
import { resolveStoreLoginMode, shouldSkipBranchSelection } from "@/lib/server/store-login-mode";
import { normalizeStoreCodeLookup, resolveTenantByStoreCode } from "@/lib/server/tenant-store-code";

type RequestBody = {
  store_code?: string;
};

type BranchSummary = {
  id: string;
  code: string | null;
  name: string | null;
  address: string | null;
  is_active: boolean;
};

type StoreLookupCacheEntry = {
  expiresAt: number;
  tenant: { id: string; code: string; publicCode: string; name: string };
  branches: BranchSummary[];
};

declare global {
  var __posStoreLookupCache: Map<string, StoreLookupCacheEntry> | undefined;
}

const STORE_LOOKUP_CACHE_TTL_MS = 5 * 60_000;

function getStoreLookupCache() {
  if (!globalThis.__posStoreLookupCache) {
    globalThis.__posStoreLookupCache = new Map<string, StoreLookupCacheEntry>();
  }
  return globalThis.__posStoreLookupCache;
}

function readStoreLookupCache(storeCode: string): StoreLookupCacheEntry | null {
  const cache = getStoreLookupCache();
  const entry = cache.get(storeCode);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(storeCode);
    return null;
  }
  return entry;
}

function writeStoreLookupCache(storeCode: string, entry: Omit<StoreLookupCacheEntry, "expiresAt">) {
  getStoreLookupCache().set(storeCode, {
    ...entry,
    expiresAt: Date.now() + STORE_LOOKUP_CACHE_TTL_MS
  });
}

function isAutoSkipEnabled() {
  const raw = String(process.env.POS_AUTO_SKIP_SINGLE_BRANCH ?? "true").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function clearPosSessionCookies(response: NextResponse) {
  const config = resolveSessionCookieConfig();
  response.cookies.set({
    name: config.name,
    value: "",
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    domain: config.domain,
    maxAge: 0
  });
  response.cookies.set({
    name: config.sessionIdName,
    value: "",
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    domain: config.domain,
    maxAge: 0
  });
}

function runInBackground(task: () => Promise<unknown>) {
  void task().catch((error) => {
    console.error("[auth/store-code/verify] background task failed", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const storeCode = normalizeStoreCodeLookup(body?.store_code).value;
  const clientIp = getClientIpAddress(request);
  const { ipAddress, userAgent } = getRequestMeta(request);

  if (!storeCode) {
    const response = NextResponse.json(
      { data: null, error: { code: "store_code_required", message: "กรุณากรอกรหัสร้านค้า" } },
      { status: 400 }
    );
    const durationMs = Date.now() - startedAt;
    response.headers.set("x-auth-api-ms", String(durationMs));
    response.headers.set("server-timing", `total;dur=${durationMs}`);
    return response;
  }

  let rateResult: RateLimitResult;
  try {
    rateResult = await withAuthTimeout(
      enforceRateLimit({
        namespace: "store_code_verify",
        key: buildRateLimitKey({ namespace: "login:store-code", parts: [clientIp, storeCode] }),
        max: readRateLimitSetting("POS_STORE_RESOLVE_RATE_LIMIT_MAX", 30, { min: 5, max: 500 }),
        windowMs: readRateLimitSetting("POS_PUBLIC_RATE_LIMIT_WINDOW_SECONDS", 60, { min: 10, max: 3600 }) * 1000
      }),
      "store_rate_limit_timeout"
    );
  } catch (error) {
    if (error instanceof AuthTimeoutError) {
      const response = NextResponse.json(
        { data: null, error: { code: "auth_timeout", message: "ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง" } },
        { status: 504 }
      );
      const durationMs = Date.now() - startedAt;
      response.headers.set("x-auth-api-ms", String(durationMs));
      response.headers.set("server-timing", `total;dur=${durationMs}`);
      return response;
    }
    throw error;
  }
  if (!rateResult.ok) {
    const response = NextResponse.json(
      { data: null, error: { code: "rate_limited", message: "มีการพยายามเข้าสู่ระบบมากเกินไป กรุณาลองใหม่อีกครั้ง" } },
      { status: 429 }
    );
    response.headers.set("Retry-After", String(rateResult.retryAfterSeconds));
    const durationMs = Date.now() - startedAt;
    response.headers.set("x-auth-api-ms", String(durationMs));
    response.headers.set("server-timing", `total;dur=${durationMs}`);
    return response;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const cachedLookup = readStoreLookupCache(storeCode);
    let lookup: StoreLookupCacheEntry | null = cachedLookup;

    if (!lookup) {
      const resolvedTenant = await withAuthTimeout(resolveTenantByStoreCode(storeCode), "store_tenant_lookup_timeout");

      if (!resolvedTenant || resolvedTenant.isActive === false) {
        runInBackground(() =>
          writeAuditLog({
            actorRole: "system",
            action: "store_code_login_attempt",
            targetType: "store_code",
            targetId: storeCode,
            ipAddress,
            userAgent,
            metadata: { success: false, reason: "store_not_found" }
          })
        );
        const response = NextResponse.json(
          { data: null, error: { code: "store_not_found", message: "ไม่พบรหัสร้านค้านี้ หรือร้านค้าถูกปิดใช้งาน" } },
          { status: 404 }
        );
        const durationMs = Date.now() - startedAt;
        response.headers.set("x-auth-api-ms", String(durationMs));
        response.headers.set("server-timing", `total;dur=${durationMs}`);
        return response;
      }

      const { data: branchRows, error: branchError } = await withAuthTimeout(
        supabase
          .from("branches")
          .select("id,code,name,address,is_active")
          .eq("tenant_id", resolvedTenant.tenantId)
          .eq("is_active", true)
          .order("name", { ascending: true }),
        "store_branch_lookup_timeout"
      );

      if (branchError) {
        console.error("[auth/store-code/verify] branch lookup failed", {
          tenantId: resolvedTenant.tenantId,
          storeCode,
          error: branchError.message
        });
        const response = NextResponse.json(
          { data: null, error: { code: "branch_lookup_failed", message: "ไม่สามารถโหลดรายการสาขาได้ในขณะนี้" } },
          { status: 500 }
        );
        const durationMs = Date.now() - startedAt;
        response.headers.set("x-auth-api-ms", String(durationMs));
        response.headers.set("server-timing", `total;dur=${durationMs}`);
        return response;
      }

      lookup = {
        expiresAt: 0,
        tenant: {
          id: resolvedTenant.tenantId,
          code: resolvedTenant.internalCode,
          publicCode: resolvedTenant.publicCode,
          name: resolvedTenant.name
        },
        branches: ((branchRows ?? []) as BranchSummary[]).filter((branch) => branch.is_active)
      };
      writeStoreLookupCache(storeCode, {
        tenant: lookup.tenant,
        branches: lookup.branches
      });
    }

    const tenant = lookup.tenant;
    const branches = lookup.branches;
    const storeMode = await withAuthTimeout(resolveStoreLoginMode(tenant.id), "store_login_mode_lookup_timeout");
    const autoSkip = shouldSkipBranchSelection(storeMode, branches.length, isAutoSkipEnabled());
    const selectedBranch = autoSkip ? branches[0] : null;
    const flowState = createFlowState({
      stage: autoSkip ? "branch_selected" : "store_verified",
      tenantId: tenant.id,
      storeCode: tenant.code,
      tenantName: tenant.name,
      branchId: selectedBranch?.id ?? null,
      branchCode: selectedBranch?.code ?? null,
      branchName: selectedBranch?.name ?? null
    });

    const response = NextResponse.json({
      data: {
        tenant: {
          name: tenant.name,
          code: tenant.publicCode
        },
        branches: branches.map((branch) => ({
          id: branch.id,
          code: branch.code,
          name: branch.name,
          address: branch.address
        })),
        next_step: autoSkip ? "employee" : "branches",
        auto_skip_branch_selection: autoSkip,
        store_mode: {
          single_register: storeMode.singleRegister,
          branch_selection: storeMode.branchSelection,
          max_branches: storeMode.maxBranches,
          max_devices: storeMode.maxDevices,
          package_code: storeMode.packageCode
        }
      },
      error: null
    });
    writePreEntryFlowState(response, flowState);
    clearPosSessionCookies(response);

    runInBackground(() =>
      writeAuditLog({
        tenantId: tenant.id,
        actorRole: "system",
        action: "store_code_login_attempt",
        targetType: "tenant",
        targetId: tenant.id,
        ipAddress,
        userAgent,
        metadata: {
          success: true,
          branch_count: branches.length,
          auto_skip_branch_selection: autoSkip,
          store_code_kind: storeCode === tenant.code ? "legacy" : "access_code"
        }
      })
    );

    const durationMs = Date.now() - startedAt;
    response.headers.set("x-auth-api-ms", String(durationMs));
    response.headers.set("server-timing", `total;dur=${durationMs}`);
    return response;
  } catch (error) {
    if (error instanceof AuthTimeoutError) {
      console.warn("[auth/store-code/verify] timeout", {
        storeCode,
        code: error.code,
        timeoutMs: error.timeoutMs
      });
      const response = NextResponse.json(
        { data: null, error: { code: "auth_timeout", message: "ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง" } },
        { status: 504 }
      );
      const durationMs = Date.now() - startedAt;
      response.headers.set("x-auth-api-ms", String(durationMs));
      response.headers.set("server-timing", `total;dur=${durationMs}`);
      return response;
    }
    console.error("[auth/store-code/verify] unexpected error", {
      storeCode,
      error: error instanceof Error ? error.message : "Unknown error"
    });

    const response = NextResponse.json(
      { data: null, error: { code: "store_verify_failed", message: "ไม่สามารถตรวจสอบรหัสร้านค้าได้ในขณะนี้" } },
      { status: 500 }
    );
    const durationMs = Date.now() - startedAt;
    response.headers.set("x-auth-api-ms", String(durationMs));
    response.headers.set("server-timing", `total;dur=${durationMs}`);
    return response;
  }
}

export async function DELETE() {
  const response = NextResponse.json({ data: { cleared: true }, error: null });
  clearPreEntryFlowState(response);
  return response;
}
