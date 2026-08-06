import { afterEach, describe, expect, it } from "vitest";
import { buildHeartbeatPayload, detectSurface, resolveDeviceCode, resolveMachineId } from "@/lib/pos/device-heartbeat-client";

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
