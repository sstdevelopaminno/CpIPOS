import { afterEach, describe, expect, it, vi } from "vitest";
import { hasLocalWindowsPrintBridge, testInstalledWindowsPrinter } from "@/lib/printing/windows-local-printer-test";

function stubWindowsRuntime(healthUrl = "http://127.0.0.1:3210/health", token = "test-token") {
  vi.stubGlobal("window", {
    CpIPOSWindowsRuntime: { bridge_health_url: healthUrl, bridge_token: token },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Windows direct native receipt test", () => {
  it("submits only one test to the installed, selected XP-80C queue", async () => {
    stubWindowsRuntime();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/printers")) {
        return { ok: true, json: async () => ({
          ok: true, data: { resolved_printer: "XP-80C", printers: [
            { name: "XP-80C", is_valid: true },
            { name: "Bad Queue", is_valid: false }
          ] }
        }) } as Response;
      }
      return { ok: true, json: async () => ({
        ok: true, data: { printed: true, printer_name: "XP-80C", job_id: "win-test-1" }
      }) } as Response;
    }));

    expect(hasLocalWindowsPrintBridge()).toBe(true);
    await expect(testInstalledWindowsPrinter("XP-80C")).resolves.toEqual({
      printer: "XP-80C", spoolJobId: "win-test-1"
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:3210/printers",
      "http://127.0.0.1:3210/print/test"
    ]);
    expect(calls[0].init?.headers).toMatchObject({ "X-CpIPOS-Bridge-Token": "test-token" });
    expect(calls[1].init?.method).toBe("POST");
    expect(calls[1].init?.body).toBe(JSON.stringify({ printer_name: "XP-80C" }));
  });

  it("does not submit a test if a different Windows printer is selected", async () => {
    stubWindowsRuntime();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      ok: true, data: { resolved_printer: "Microsoft Print to PDF", printers: [
        { name: "XP-80C", is_valid: true },
        { name: "Microsoft Print to PDF", is_valid: true }
      ] }
    }) } as Response));
    vi.stubGlobal("fetch", fetchMock);
    await expect(testInstalledWindowsPrinter("XP-80C")).rejects.toThrow("ยังไม่ได้เลือก XP-80C");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects arbitrary remote server URL without dispatching a print job", async () => {
    stubWindowsRuntime("https://remote.example.org/health");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(testInstalledWindowsPrinter("XP-80C")).rejects.toThrow("ไม่พบ Windows Print Bridge");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires native WebView2 runtime; plain Chrome cannot test Windows queue", async () => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(hasLocalWindowsPrintBridge()).toBe(false);
    await expect(testInstalledWindowsPrinter("XP-80C")).rejects.toThrow("โปรแกรม CpiPOS Windows Web POS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
