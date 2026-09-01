import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const globalAlert = source("../../src/components/pos-preview/pos-table-qr-global-alert.tsx");
const tableOrderMobile = source("../../src/components/table-order/table-order-mobile.tsx");
const nativeCustomerDisplay = source("../../src/components/pos/pos-customer-display-v2-native.tsx");
const instrumentationClient = source("../../src/instrumentation-client.ts");
const androidMandatoryUpdate = source("../../src/components/android-pos/android-pos-mandatory-update.tsx");
const productMediaRoute = source("../../src/app/api/pos/product-media/route.ts");
const perfRoute = source("../../src/app/api/pos/perf/route.ts");
const systemVersionRoute = source("../../src/app/api/system/version/route.ts");
const systemBuildInfoRoute = source("../../src/app/api/system/build-info/route.ts");
const featureGate = source("../../src/lib/feature-gate.ts");
const posResilience = source("../../src/lib/pos-resilience.ts");
const boundedTimeout = source("../../src/lib/server/bounded-timeout.ts");

describe("polling request-churn regression guard", () => {
  it("backs global POS Table QR alerts off to a 30-60s recurring network cadence", () => {
    expect(globalAlert).toContain("const IDLE_POLL_MS = [30_000, 45_000, 60_000] as const");
    expect(globalAlert).toContain("const ACTIVITY_REQUEST_TIMEOUT_MS = 10_000");
    expect(globalAlert).toContain("fetchWithTimeout(");
    expect(globalAlert).toContain("inFlightRef.current");
    expect(globalAlert).toContain('document.visibilityState === "hidden"');
    expect(globalAlert).toContain('window.addEventListener("focus", onFocus)');
    expect(globalAlert).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
  });

  it("keeps customer Table QR status reads non-overlapping and enforces a 30s browser network floor", () => {
    expect(tableOrderMobile).toContain('cancelled || inFlight || document.visibilityState === "hidden"');
    expect(tableOrderMobile).toContain("inFlight = true");
    expect(tableOrderMobile).toContain("inFlight = false");
    expect(tableOrderMobile).toContain("?view=status");
    expect(instrumentationClient).toContain("const HOT_READ_MIN_INTERVAL_MS = 30_000");
    expect(instrumentationClient).toContain('/^\\/api\\/table-order\\/[^/]+$/');
    expect(instrumentationClient).toContain('if (isStatusRead) return `${prefix}${url.pathname}?view=status`');
  });

  it("coalesces legacy table reads while invalidating them on API mutations", () => {
    expect(instrumentationClient).toContain('if (url.pathname === "/api/pos/tables")');
    expect(instrumentationClient).toContain('/^\\/api\\/pos\\/tables\\/[^/]+\\/bill$/');
    expect(instrumentationClient).toContain('/^\\/api\\/pos\\/tables\\/[^/]+\\/qr-orders$/');
    expect(instrumentationClient).toContain("invalidateBudgetedReadsForMutation(input, init)");
    expect(instrumentationClient).toContain("readScopeEpoch += 1");
    expect(instrumentationClient).toContain("hotReadCache.clear()");
    expect(instrumentationClient).toContain('if (url.pathname === "/api/pos/perf") return');
  });

  it("never places transaction/payment/order writes into the browser read cache", () => {
    expect(instrumentationClient).toContain('if (requestMethod(input, init) !== "GET") return null');
    expect(instrumentationClient).toContain("hotReadInFlight");
    expect(instrumentationClient).toContain("cached.response.clone()");
    expect(instrumentationClient).not.toContain('/api/pos/payments');
    expect(instrumentationClient).not.toContain('/api/pos/orders');
  });

  it("samples normal POS telemetry to at most one request per minute while preserving errors", () => {
    expect(instrumentationClient).toContain("const PERF_TELEMETRY_MIN_INTERVAL_MS = 60_000");
    expect(instrumentationClient).toContain('url.pathname !== "/api/pos/perf"');
    expect(instrumentationClient).toContain("if (errorCode || (Number.isFinite(statusCode) && statusCode >= 400)) return null");
    expect(instrumentationClient).toContain("client_sampled: true");
    expect(perfRoute).toContain("export const maxDuration = 10");
    expect(perfRoute).toContain("const PERF_SAMPLE_TTL_MS = 60_000");
  });

  it("moves native customer-display polling to 30s and backs failures off to 60s", () => {
    expect(nativeCustomerDisplay).toContain("const HEALTHY_POLL_MS = 30_000");
    expect(nativeCustomerDisplay).toContain("const DEVICE_STATE_BACKOFF_MS = 60_000");
    expect(nativeCustomerDisplay).toContain("const AUTH_BACKOFF_MS = 60_000");
    expect(nativeCustomerDisplay).toContain("const MAX_TRANSIENT_BACKOFF_MS = 60_000");
    expect(nativeCustomerDisplay).toContain('document.visibilityState !== "visible"');
  });

  it("keeps browser update enforcement low-frequency and visible-only", () => {
    expect(androidMandatoryUpdate).toContain("const POLL_MS = 10 * 60_000");
    expect(androidMandatoryUpdate).toContain("window.setInterval");
    expect(androidMandatoryUpdate).toContain("document.visibilityState === \"visible\"");
    expect(androidMandatoryUpdate).toContain("/api/android-pos/update-enforcement");
    expect(androidMandatoryUpdate).toContain("setRequired(false)");
    expect(androidMandatoryUpdate).not.toContain("setTimeout");
  });

  it("enforces the 15s serverless timeout ceiling and 30s minimum monitor polling", () => {
    expect(posResilience).toContain("const SERVERLESS_TIMEOUT_CEILING_MS = 15_000");
    expect(posResilience).toContain('clientMonitorPollMs: readIntEnv("NEXT_PUBLIC_POS_MONITOR_POLL_MS", 30000, 30000, 120000)');
    expect(boundedTimeout).toContain("const SERVERLESS_TIMEOUT_CEILING_MS = 15_000");
    expect(boundedTimeout).toContain("Math.min(Math.trunc(timeoutMs), SERVERLESS_TIMEOUT_CEILING_MS)");
  });

  it("edge-caches only shared system metadata in this emergency patch", () => {
    const expected = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';
    expect(systemVersionRoute).toContain(expected);
    expect(systemBuildInfoRoute).toContain(expected);
    expect(systemVersionRoute).toContain("export const maxDuration = 5");
    expect(systemBuildInfoRoute).toContain("export const maxDuration = 5");
  });

  it("keeps product-media POS reads off the tenant-wide quota path unless explicitly requested", () => {
    expect(productMediaRoute).toContain('url.searchParams.get("include_quota")');
    expect(productMediaRoute).toContain("const quota = includeQuota ? await resolveProductMediaQuota(resolved.tenantId) : null");
    expect(productMediaRoute).not.toContain("Promise.all([\n      loadProductMediaMap");
  });

  it("collapses repeated feature entitlement contract reads during POS startup", () => {
    expect(featureGate).toContain("__latestContractInFlight");
    expect(featureGate).toContain("readLatestContractCache(tenantId)");
    expect(featureGate).toContain("writeLatestContractCache(tenantId, resolved)");
    expect(featureGate).toContain("contractInFlight.clear()");
  });
});
