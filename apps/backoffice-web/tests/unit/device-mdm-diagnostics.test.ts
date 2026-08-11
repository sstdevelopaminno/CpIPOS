import { describe, expect, it } from "vitest";
import { buildDeviceMdmHealthSnapshot, type DeviceMdmHealthInput } from "@/lib/device-mdm-diagnostics";

function buildInput(profile: "browser" | "android" | "windows_runtime"): DeviceMdmHealthInput {
  const machinePrefix = profile === "browser" ? "web" : profile === "android" ? "and" : "win";
  return {
    identity: {
      tenant_id: "tenant-1",
      branch_id: "branch-1",
      device_code: "POS-COUNTER-01",
      machine_id: `${machinePrefix}-machine-1`,
      runtime_version: profile === "windows_runtime" ? "1.0.0" : null,
      app_version: null
    },
    connectivity: {
      internet_online: true,
      server_reachable: true,
      dns_healthy: null,
      network_type: profile,
      latency_ms: null
    },
    system: {
      os_name: profile === "android" ? "Android" : profile === "windows_runtime" ? "Windows" : null
    },
    runtime: {
      cpi_windows_runtime_running: profile === "windows_runtime",
      local_bridge_online: profile === "windows_runtime",
      bridge_version: profile === "windows_runtime" ? "1.0.0" : null
    },
    peripherals: profile === "windows_runtime"
      ? {
          selected_printer: "POS-80",
          selected_printer_valid: true,
          printer_status: "ready"
        }
      : {},
    offline_sale: null,
    security_signals: [],
    metadata: {
      source: `web_pos_session_heartbeat_${profile}`,
      telemetry_profile: profile
    },
    captured_at: "2026-08-11T15:30:00.000Z"
  };
}

describe("device MDM telemetry classification", () => {
  it("does not report Windows runtime or printer failures for a plain browser heartbeat", () => {
    const input = buildInput("browser");
    input.runtime.cpi_windows_runtime_running = false;
    input.runtime.local_bridge_online = false;

    const snapshot = buildDeviceMdmHealthSnapshot(input);

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.incidents.map((incident) => incident.code)).not.toContain("runtime_offline");
    expect(snapshot.incidents.map((incident) => incident.code)).not.toContain("local_bridge_offline");
    expect(snapshot.incidents.map((incident) => incident.code)).not.toContain("printer_missing");
  });

  it("does not report Windows-only failures for Android heartbeat telemetry", () => {
    const input = buildInput("android");
    input.runtime.cpi_windows_runtime_running = false;
    input.runtime.local_bridge_online = false;

    const snapshot = buildDeviceMdmHealthSnapshot(input);

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.incidents).toHaveLength(0);
  });

  it("still reports Local Bridge and printer failures for a Windows runtime heartbeat", () => {
    const input = buildInput("windows_runtime");
    input.runtime.local_bridge_online = false;
    input.peripherals = {
      selected_printer: null,
      selected_printer_valid: false,
      printer_status: "invalid"
    };

    const snapshot = buildDeviceMdmHealthSnapshot(input);
    const codes = snapshot.incidents.map((incident) => incident.code);

    expect(snapshot.status).toBe("critical");
    expect(codes).toContain("local_bridge_offline");
    expect(codes).toContain("printer_missing");
    expect(codes).toContain("printer_error");
  });

  it("keeps a healthy Windows runtime healthy when runtime, bridge, and printer are ready", () => {
    const snapshot = buildDeviceMdmHealthSnapshot(buildInput("windows_runtime"));

    expect(snapshot.status).toBe("healthy");
    expect(snapshot.incidents).toHaveLength(0);
  });
});
