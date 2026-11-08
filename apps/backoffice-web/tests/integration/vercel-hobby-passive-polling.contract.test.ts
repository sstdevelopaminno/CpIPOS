import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Vercel Hobby CPU: safe passive POS request reductions", () => {
  const sales = source("src/components/pos/pos-sales-module.tsx");
  const attendance = source("src/components/pos/pos-sales-mvp.tsx");
  const monitor = source("src/app/api/pos/monitor/route.ts");

  it("polls passive monitor snapshots on the server cache's 60s cadence by default", () => {
    expect(sales).toContain('NEXT_PUBLIC_POS_MONITOR_POLL_MS ?? "60000"');
    expect(monitor).toContain("ttlMs: 60_000");
    expect(sales).toContain("const MIN_MONITOR_FOCUS_GAP_MS = 15_000");
    expect(sales).toContain("now - lastMonitorRequestAt < MIN_MONITOR_FOCUS_GAP_MS");
    expect(sales).toContain("monitorPollInFlightRef.current");
    expect(sales).toContain('document.visibilityState === "visible"');
  });

  it("does not overlap legacy attendance polls or poll hidden tabs", () => {
    expect(attendance).toContain("document.visibilityState !== \"visible\" || inFlight");
    expect(attendance).toContain("inFlight = true");
    expect(attendance).toContain("inFlight = false");
    expect(attendance).toContain("}, 20000);");
  });

  it("leaves live kitchen/payment order channels on their existing paths", () => {
    expect(sales).toContain("const pollTableQrOrders = async () =>");
    expect(sales).toContain("const pollStatus = async () =>");
    expect(sales).toContain("const interval = window.setInterval(refreshActiveTableBill, ACTIVE_TABLE_BILL_SYNC_INTERVAL_MS)");
  });
});
