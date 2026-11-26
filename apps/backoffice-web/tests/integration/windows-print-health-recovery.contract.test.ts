import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Windows print health freshness", () => {
  const sender = read("src/components/pos/pos-device-heartbeat-sender.tsx");
  const worker = read("src/components/printing/windows-native-print-agent.tsx");
  const route = read("src/app/api/pos/windows-print/agent/route.ts");

  it("refreshes Windows snapshots before the strict authorization deadline, without accelerating Android or browser", () => {
    expect(route).toContain("HEARTBEAT_MAX_AGE_MS = 180_000");
    expect(sender).toContain("WINDOWS_HEARTBEAT_INTERVAL_MS = 120_000");
    expect(sender).toContain("HEARTBEAT_INTERVAL_MS = 5 * 60_000");
    expect(sender).toContain('surface === "windows_runtime" ? WINDOWS_HEARTBEAT_INTERVAL_MS : HEARTBEAT_INTERVAL_MS');
    expect(route).toContain("connectedPrinter.selected_printer_valid !== true");
  });

  it("refreshes actual device health on server rejection with a bounded, serialized recovery signal", () => {
    expect(worker).toContain('error.message === "windows_agent_offline"');
    expect(worker).toContain('new Event("cpi-windows-print-health-recovery")');
    expect(sender).toContain("now - lastWindowsRecoveryAt < HEARTBEAT_MIN_GAP_MS");
    expect(sender).toContain('surface !== "windows_runtime" || cancelled || !initialized || inFlightRef.current');
    expect(sender).toContain('window.removeEventListener("cpi-windows-print-health-recovery", handleWindowsPrintHealthRecovery)');
    expect(worker).toContain("nextMs = 15_000;");
    expect(worker).toContain("if (stopped || inFlight) return;");
    expect(worker).toContain("markAttempted(job.id)");
    expect(route).toContain("PRINT_JOB_MAX_AGE_MS = 150_000");
  });
});
