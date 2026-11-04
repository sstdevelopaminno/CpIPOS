import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHeartbeatPayload,
  detectSurface,
  executePendingActions,
  resolveDeviceCode,
  resolveMachineId
} from "@/lib/pos/device-heartbeat-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  globalThis.fetch = originalFetch;
});

describe("device heartbeat client", () => {
  it("detects browser surface and builds a payload with no bridge data when no runtime globals are present", async () => {
    expect(detectSurface()).toBe("browser");

    const payload = await buildHeartbeatPayload({
      surface: "browser",
      deviceCode: "POS-01",
      machineId: "web-test-machine",
      startedAt: Date.now(),
      reason: "startup"
    });

    expect(payload.identity.device_code).toBe("POS-01");
    expect(payload.identity.machine_id).toBe("web-test-machine");
    expect(payload.runtime.cpi_windows_runtime_running).toBe(false);
    expect(payload.runtime.local_bridge_online).toBe(false);
    expect(payload.metadata.source).toBe("web_pos_session_heartbeat_browser");
    expect(payload.metadata.reason).toBe("startup");
    expect(typeof payload.captured_at).toBe("string");
  });

  it("detects windows_runtime surface and merges bridge health when window.CpIPOSWindowsRuntime is present", async () => {
    const bridgeHealth = {
      ok: true,
      bridge_version: "1.2.3",
      print_queue_busy: false,
      system_default_printer: "MTP-II"
    };

    (globalThis as { window?: unknown }).window = {
      CpIPOSWindowsRuntime: {
        native_app_version: "0.1.7",
        native_bridge_version: "1.2.3",
        bridge_health_url: "http://127.0.0.1:3210/health"
      },
      localStorage: {
        store: new Map<string, string>(),
        getItem(key: string) {
          return this.store.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          this.store.set(key, value);
        }
      }
    };
    (globalThis as { fetch?: unknown }).fetch = async () => ({
      ok: true,
      json: async () => bridgeHealth
    });

    expect(detectSurface()).toBe("windows_runtime");

    const machineId = resolveMachineId("windows_runtime");
    expect(machineId.startsWith("win-")).toBe(true);
    expect(resolveDeviceCode("windows_runtime", null)).toBe("POS-DEVICE");

    const payload = await buildHeartbeatPayload({
      surface: "windows_runtime",
      deviceCode: "POS-02",
      machineId,
      startedAt: Date.now(),
      reason: "interval"
    });

    expect(payload.runtime.cpi_windows_runtime_running).toBe(true);
    expect(payload.runtime.local_bridge_online).toBe(true);
    expect(payload.runtime.bridge_version).toBe("1.2.3");
    expect(payload.peripherals.default_printer).toBe("MTP-II");
    expect(payload.metadata.source).toBe("web_pos_session_heartbeat_windows_runtime");
  });
});

describe("executePendingActions", () => {
  it("marks native runtime service controls as not applied without side effects", async () => {
    const results = await executePendingActions([
      { id: "1", command_type: "clear_print_queue", issued_at: "2026-08-06T00:00:00Z" },
      { id: "2", command_type: "restart_local_bridge", issued_at: "2026-08-06T00:00:00Z" },
      { id: "3", command_type: "restart_print_service", issued_at: "2026-08-06T00:00:00Z" }
    ]);

    expect(results).toEqual([
      { id: "1", command_type: "clear_print_queue", applied: false },
      { id: "2", command_type: "restart_local_bridge", applied: false },
      { id: "3", command_type: "restart_print_service", applied: false }
    ]);
  });

  it("applies disable_device/enable_device and request_diagnostics_bundle as already-satisfied", async () => {
    const results = await executePendingActions([
      { id: "3", command_type: "disable_device", issued_at: "2026-08-06T00:00:00Z" },
      { id: "4", command_type: "enable_device", issued_at: "2026-08-06T00:00:00Z" },
      { id: "5", command_type: "request_diagnostics_bundle", issued_at: "2026-08-06T00:00:00Z" }
    ]);

    expect(results.every((result) => result.applied)).toBe(true);
  });

  it("reloads the page for reload_ui", async () => {
    const reload = vi.fn();
    (globalThis as { window?: unknown }).window = { location: { reload } };

    const results = await executePendingActions([{ id: "6", command_type: "reload_ui", issued_at: "2026-08-06T00:00:00Z" }]);

    expect(results).toEqual([{ id: "6", command_type: "reload_ui", applied: true }]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("unwraps the Windows native bridge health envelope and reports XP-80C", async () => {
    (globalThis as { window?: unknown }).window = {
      CpIPOSWindowsRuntime: {
        native_app_version: "0.1.9",
        native_bridge_version: "cpipos-windows-native-bridge-0.1.9",
        bridge_health_url: "http://127.0.0.1:3210/health"
      }
    };
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          bridge_version: "cpipos-windows-native-bridge-0.1.9",
          system_default_printer: "XP-80C",
          resolved_printer: "XP-80C",
          selected_printer_valid: true
        }
      })
    })) as typeof fetch;

    const payload = await buildHeartbeatPayload({
      surface: "windows_runtime",
      deviceCode: "POS001",
      machineId: "win-unit-test",
      startedAt: Date.now(),
      reason: "interval"
    });
    expect(payload.runtime.local_bridge_online).toBe(true);
    expect(payload.peripherals.default_printer).toBe("XP-80C");
    expect(payload.peripherals.selected_printer).toBe("XP-80C");
    expect(payload.peripherals.selected_printer_valid).toBe(true);
  });

  it("tests Windows printer through authenticated loopback only", async () => {
    (globalThis as { window?: unknown }).window = {
      CpIPOSWindowsRuntime: {
        bridge_health_url: "http://127.0.0.1:3210/health",
        bridge_token: "per-launch-unit-token"
      }
    };
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => ({ ok: true, data: { printed: true } }) } as Response;
    }) as typeof fetch;

    const result = await executePendingActions([{ id: "win-1", command_type: "test_printer", issued_at: "2026-11-04T00:00:00Z" }]);
    expect(result).toEqual([{ id: "win-1", command_type: "test_printer", applied: true }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:3210/print/test");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)?.["X-CpIPOS-Bridge-Token"]).toBe("per-launch-unit-token");
  });

  it("rejects non-loopback printer command targets even with a token", async () => {
    (globalThis as { window?: unknown }).window = {
      CpIPOSWindowsRuntime: {
        bridge_health_url: "http://remote-printer.example/health",
        bridge_token: "per-launch-unit-token"
      }
    };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    const result = await executePendingActions([{ id: "win-2", command_type: "test_printer", issued_at: "2026-11-04T00:00:00Z" }]);
    expect(result).toEqual([{ id: "win-2", command_type: "test_printer", applied: false }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refresh_config is not applied without a Windows Runtime entitlements URL", async () => {
    const results = await executePendingActions([{ id: "7", command_type: "refresh_config", issued_at: "2026-08-06T00:00:00Z" }]);
    expect(results).toEqual([{ id: "7", command_type: "refresh_config", applied: false }]);
  });
  it("accepts check_update as a safe update telemetry refresh", async () => {
    const results = await executePendingActions([{ id: "8", command_type: "check_update", issued_at: "2026-08-06T00:00:00Z" }]);
    expect(results).toEqual([{ id: "8", command_type: "check_update", applied: true }]);
  });
});

describe("Windows managed printer selection", () => {
  it("reports the exact installed XP-80C queue in Windows telemetry", async () => {
    (globalThis as { window?: unknown }).window = {
      CpIPOSWindowsRuntime: {
        bridge_health_url: "http://127.0.0.1:3210/health",
        bridge_token: "unit-launch-token",
        native_app_version: "0.2.0",
        native_bridge_version: "cpipos-windows-native-bridge-0.2.0"
      }
    };
    const requests: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      requests.push(String(url));
      if (String(url).endsWith("/printers")) return {
        ok: true,
        json: async () => ({
          ok: true,
          data: { printers: [
            { name: "XP-80C", is_valid: true },
            { name: "Broken Print Queue", is_valid: false }
          ] }
        })
      } as Response;
      return {
        ok: true,
        json: async () => ({ ok: true, data: {
          system_default_printer: "XP-80C",
          resolved_printer: "XP-80C",
          selected_printer_valid: true
        } })
      } as Response;
    }) as typeof fetch;
    const payload = await buildHeartbeatPayload({
      surface: "windows_runtime",
      deviceCode: "POS001",
      machineId: "win-abc123",
      startedAt: Date.now(),
      reason: "startup"
    });
    expect(payload.peripherals.selected_printer).toBe("XP-80C");
    expect(payload.peripherals.installed_printers).toEqual(["XP-80C"]);
    expect(requests).toEqual([
      "http://127.0.0.1:3210/health",
      "http://127.0.0.1:3210/printers"
    ]);
  });

  it("sends scoped remote selection to the native bridge and checks persistence", async () => {
    (globalThis as { window?: unknown }).window = {
      CpIPOSWindowsRuntime: {
        bridge_health_url: "http://127.0.0.1:3210/health",
        bridge_token: "unit-launch-token"
      }
    };
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => ({
        ok: true,
        data: { selected_printer: "XP-80C", persisted: true }
      }) } as Response;
    }) as typeof fetch;
    const result = await executePendingActions([{
      id: "cmd-windows-1",
      command_type: "set_printer",
      printer_name: "XP-80C",
      issued_at: "2026-11-04T00:00:00Z"
    }]);
    expect(result).toEqual([{ id: "cmd-windows-1", command_type: "set_printer", applied: true }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:3210/printers/select");
    expect((calls[0].init?.headers as Record<string, string>)["X-CpIPOS-Bridge-Token"]).toBe("unit-launch-token");
    expect(calls[0].init?.body).toBe(JSON.stringify({ printer_name: "XP-80C" }));
  });

  it("does not contact a non-loopback printer server or accept an unexpected queue", async () => {
    (globalThis as { window?: unknown }).window = {
      CpIPOSWindowsRuntime: {
        bridge_health_url: "https://remote.example.com/health",
        bridge_token: "unit-launch-token"
      }
    };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const result = await executePendingActions([{
      id: "cmd-windows-2",
      command_type: "set_printer",
      printer_name: "XP-80C",
      issued_at: "2026-11-04T00:00:00Z"
    }]);
    expect(result[0].applied).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
