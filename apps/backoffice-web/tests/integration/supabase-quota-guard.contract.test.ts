import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Supabase log-ingestion guard", () => {
  const shiftGuard = src("src/components/pos/pos-shift-cycle-guard.tsx");
  const salesModePolicy = src("src/components/pos/pos-sales-mode-policy-controller.tsx");
  const featureRoute = src("src/app/api/pos/features/route.ts");
  const featureGate = src("src/lib/feature-gate.ts");
  const lifecycle = src("src/lib/services/pos-subscription-lifecycle-guard-service.ts");
  const devicePolicy = src("src/lib/pos-device-status.ts");
  const authContext = src("src/lib/auth-context.ts");
  const posSession = src("src/lib/pos-session-guard.ts");
  const sessionCurrent = src("src/app/api/pos/session/current/route.ts");

  it("does not verify POS clock every minute", () => {
    expect(shiftGuard).toContain("5 * 60 * 1000");
    expect(shiftGuard).not.toContain("const CLOCK_RECHECK_INTERVAL_MS = 60 * 1000");
    expect(shiftGuard).toContain('window.addEventListener("focus", onFocus)');
  });

  it("caches the bulk POS feature snapshot and browser response", () => {
    expect(featureRoute).toContain("readThroughRuntimeCache");
    expect(featureRoute).toContain("pos-feature-bundle:");
    expect(featureRoute).toContain("ttlMs: 60_000");
    expect(featureRoute).toContain('private, max-age=60, stale-while-revalidate=60');
  });

  it("does not poll the feature policy every minute", () => {
    expect(salesModePolicy).toContain("POLICY_REFRESH_MS = 5 * 60_000");
    expect(salesModePolicy).not.toContain("POLICY_REFRESH_MS = 60_000");
    expect(salesModePolicy).toContain('cache: "default"');
  });

  it("extends feature decision and contract caching", () => {
    expect(featureGate).toContain("FEATURE_DECISION_CACHE_TTL_MS = 60_000");
    expect(featureGate).toContain("LATEST_CONTRACT_CACHE_TTL_MS = 60_000");
  });

  it("deduplicates lifecycle guard reads without caching locked state", () => {
    expect(lifecycle).toContain("GUARD_ACTIVE_CACHE_TTL_MS = 5_000");
    expect(lifecycle).toContain("__posSubscriptionLifecycleGuardInFlight");
    expect(lifecycle).toContain("if(!value || value.locked)");
    expect(lifecycle).toContain("Math.min(now+GUARD_ACTIVE_CACHE_TTL_MS,expiryAt)");
  });

  it("bounds device, session and active subscription caches and clamps expiry checks", () => {
    expect(devicePolicy).toContain("DEVICE_POLICY_CACHE_TTL_MS = 15_000");
    expect(posSession).toContain("POS_SESSION_ROW_CACHE_TTL_MS = 15000");
    expect(posSession).toContain("POS_SUBSCRIPTION_ACTIVE_CACHE_TTL_MS = 30000");
    expect(posSession).toContain("cache.delete(tenantId)");
    expect(posSession).toContain("Math.min(now+POS_SUBSCRIPTION_ACTIVE_CACHE_TTL_MS,expiryAt)");
    expect(posSession).not.toContain("POS_SUBSCRIPTION_ACCESS_CACHE_TTL_MS = 60000");
  });

  it("reduces repeated membership/profile reads with a bounded cache", () => {
    expect(authContext).toContain("AUTH_SCOPE_CACHE_TTL_MS = 30_000");
    expect(authContext).toContain("__authMembershipInFlight");
    expect(authContext).toContain("__platformRoleInFlight");
  });

  it("keeps session scope reads schema-clean and coalesces duplicate shift metrics", () => {
    expect(posSession).toContain('.from("tenants").select("id,name,code,is_active")');
    expect(posSession).not.toContain('.from("tenants").select("id,name,code,is_active,metadata")');
    expect(sessionCurrent).toContain("SHIFT_METRICS_CACHE_TTL_MS = 30_000");
  });
});
