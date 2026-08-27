import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const monitorRoute = readFileSync(resolve(process.cwd(), "src/app/api/pos/monitor/route.ts"), "utf8");
const sales = readFileSync(resolve(process.cwd(), "src/components/pos/pos-sales-module.tsx"), "utf8");

describe("POS runtime load stability contract", () => {
  it("coalesces expensive monitor DB work behind a 30 second branch cache", () => {
    expect(monitorRoute).toContain("const MONITOR_CACHE_TTL_MS = 30_000;");
    expect(monitorRoute).toContain("ttlMs: MONITOR_CACHE_TTL_MS");
    expect(monitorRoute).toContain("x-pos-monitor-cache");
  });

  it("keeps monitor polling hidden-tab aware, online aware, and single-flight", () => {
    expect(sales).toContain('document.visibilityState === "visible"');
    expect(sales).toContain("monitorPollInFlightRef.current");
    expect(sales).toContain("if (!navigator.onLine) return;");
    expect(sales).toContain("Math.min(120000, Math.max(15000");
  });

  it("keeps Table QR polling hidden-tab aware and prevents overlapping requests", () => {
    expect(sales).toContain('document.visibilityState !== "visible"');
    expect(sales).toContain("tableQrOrderPollInFlightRef.current");
    expect(sales).toContain("window.setInterval(() => void pollTableQrOrders(), 10000)");
  });

  it("keeps cash drawer readiness out of the hot transaction path", () => {
    expect(sales).toContain("cashDrawerReadinessInFlightRef.current");
    expect(sales).toContain("window.setInterval(refreshCashDrawerReadiness, 60000)");
  });
});
