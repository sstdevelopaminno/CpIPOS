import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Supabase log-ingestion guard", () => {
  const shiftGuard = src("src/components/pos/pos-shift-cycle-guard.tsx");
  const featureRoute = src("src/app/api/pos/features/route.ts");
  const featureGate = src("src/lib/feature-gate.ts");
  const lifecycle = src("src/lib/services/pos-subscription-lifecycle-guard-service.ts");
  const devicePolicy = src("src/lib/pos-device-status.ts");
  const authContext = src("src/lib/auth-context.ts");
  const posSession = src("src/lib/pos-session-guard.ts");

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

  it("extends feature decision and contract caching", () => {
    expect(featureGate).toContain("FEATURE_DECISION_CACHE_TTL_MS = 60_000");
    expect(featureGate).toContain("LATEST_CONTRACT_CACHE_TTL_MS = 60_000");
  });

  it("deduplicates lifecycle guard reads", () => {
    expect(lifecycle).toContain("GUARD_CACHE_TTL_MS = 60_000");
    expect(lifecycle).toContain("__posSubscriptionLifecycleGuardInFlight");
  });

  it("briefly caches device status without weakening session revocation checks", () => {
    expect(devicePolicy).toContain("DEVICE_POLICY_CACHE_TTL_MS = 15_000");
    expect(posSession).toContain("POS_SESSION_ROW_CACHE_TTL_MS = 4000");
    expect(posSession).toContain("POS_SUBSCRIPTION_ACCESS_CACHE_TTL_MS = 60000");
  });

  it("reduces repeated membership/profile reads with a bounded cache", () => {
    expect(authContext).toContain("AUTH_SCOPE_CACHE_TTL_MS = 30_000");
    expect(authContext).toContain("__authMembershipInFlight");
    expect(authContext).toContain("__platformRoleInFlight");
  });
});
