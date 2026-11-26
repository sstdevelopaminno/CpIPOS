import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Windows native watchdog safety", () => {
  const worker = read("src/components/printing/windows-native-print-agent.tsx");
  const host = read("../windows-runtime-native/Cpipos.WindowsRuntime/MainForm.cs");

  it("only recovers an overdue timer in the existing serialized web worker", () => {
    expect(worker).toContain("stopped || inFlight || !navigator.onLine");
    expect(worker).toContain("Date.now() - nextPollAt < 5_000");
    expect(worker).toContain('window.addEventListener("cpi-windows-native-watchdog", onWatchdogTick)');
    expect(worker).toContain("clearInterval(watchdogTimer)");
    expect(worker).toContain('window.removeEventListener("cpi-windows-native-watchdog", onWatchdogTick)');
    expect(worker).toContain("markAttempted(job.id)");
    expect(worker).toContain("if (spoolAccepted) throw error;");
  });

  it("never reloads, sends credentials, or prints from the native watchdog", () => {
    const body = host.slice(host.indexOf("private async Task CheckPrintWatchdogAsync()"), host.indexOf("private async Task SyncCustomerDisplayAsync()"));
    expect(body).toContain("IsDisposed || Disposing || _checkingPrintWatchdog || !_bridge.IsRunning");
    expect(body).toContain("_printWatchdogProbe is { IsCompleted: false }");
    expect(body).toContain("StringComparison.OrdinalIgnoreCase");
    expect(body).toContain('source.AbsolutePath == "/preview/pos"');
    expect(body).toContain("location.origin!==");
    expect(body).toContain("cpi-windows-native-watchdog");
    expect(body).toContain("WithTimeoutAsync(_printWatchdogProbe, 5000)");
    expect(body).not.toMatch(/\.Reload\(|\.Navigate\(|BridgeToken|\/print\//);
    expect(host).toContain("_printWatchdogTimer.Dispose()");
  });
});
