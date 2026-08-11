from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8-sig")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}\n--- needle ---\n{old[:700]}")
    write(path, text.replace(old, new, 1))


mdm_path = "apps/backoffice-web/src/lib/device-mdm-diagnostics.ts"

replace_once(
    mdm_path,
    '''function deriveDeviceStatus(incidents: readonly DeviceMdmIncident[], connectivity: DeviceMdmConnectivity): DeviceMdmStatus {
  if (!connectivity.internet_online && incidents.some((incident) => incident.code === "internet_offline")) return "offline";
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  if (incidents.some((incident) => incident.severity === "warning")) return "degraded";
  return "healthy";
}
''',
    '''function deriveDeviceStatus(incidents: readonly DeviceMdmIncident[], connectivity: DeviceMdmConnectivity): DeviceMdmStatus {
  if (!connectivity.internet_online && incidents.some((incident) => incident.code === "internet_offline")) return "offline";
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  if (incidents.some((incident) => incident.severity === "warning")) return "degraded";
  return "healthy";
}

type DeviceMdmTelemetryProfile = "windows_runtime" | "android" | "browser" | "generic";

function resolveDeviceMdmTelemetryProfile(input: DeviceMdmHealthInput): DeviceMdmTelemetryProfile {
  const networkType = String(input.connectivity.network_type ?? "").trim().toLowerCase();
  const source = String(input.metadata?.source ?? "").trim().toLowerCase();
  const osName = String(input.system.os_name ?? "").trim().toLowerCase();
  const machineId = String(input.identity.machine_id ?? "").trim().toLowerCase();
  const runtimeVersion = String(input.identity.runtime_version ?? "").trim();
  const bridgeVersion = String(input.runtime.bridge_version ?? "").trim();

  if (
    networkType === "windows_runtime" ||
    source.includes("windows_runtime") ||
    osName.includes("windows") ||
    machineId.startsWith("win-") ||
    runtimeVersion.length > 0 ||
    bridgeVersion.length > 0 ||
    input.runtime.bridge_port != null
  ) {
    return "windows_runtime";
  }

  if (
    networkType === "android" ||
    source.includes("_android") ||
    osName.includes("android") ||
    machineId.startsWith("and-")
  ) {
    return "android";
  }

  if (networkType === "browser" || source.includes("_browser") || machineId.startsWith("web-")) {
    return "browser";
  }

  return "generic";
}
'''
)

replace_once(
    mdm_path,
    '''  const detectedAt = input.captured_at ?? new Date().toISOString();
  const incidents: DeviceMdmIncident[] = [];
''',
    '''  const detectedAt = input.captured_at ?? new Date().toISOString();
  const incidents: DeviceMdmIncident[] = [];
  const telemetryProfile = resolveDeviceMdmTelemetryProfile(input);
  const shouldEvaluateWindowsRuntime = telemetryProfile === "windows_runtime";
  const shouldEvaluatePeripheralHealth = telemetryProfile === "windows_runtime";
'''
)

replace_once(mdm_path, '  if (!input.runtime.cpi_windows_runtime_running) {', '  if (shouldEvaluateWindowsRuntime && !input.runtime.cpi_windows_runtime_running) {')
replace_once(mdm_path, '  if (!input.runtime.local_bridge_online) {', '  if (shouldEvaluateWindowsRuntime && !input.runtime.local_bridge_online) {')
replace_once(
    mdm_path,
    '  if (input.peripherals.selected_printer_valid === false || !input.peripherals.selected_printer) {',
    '  if (shouldEvaluatePeripheralHealth && (input.peripherals.selected_printer_valid === false || !input.peripherals.selected_printer)) {'
)
replace_once(
    mdm_path,
    '  if (printerStatus && printerStatus !== "normal" && printerStatus !== "ready") {',
    '  if (shouldEvaluatePeripheralHealth && printerStatus && printerStatus !== "normal" && printerStatus !== "ready") {'
)
replace_once(
    mdm_path,
    '  if (input.runtime.print_queue_busy || (printQueueCount !== null && printQueueCount >= thresholds.print_queue_warning_count)) {',
    '  if (shouldEvaluatePeripheralHealth && (input.runtime.print_queue_busy || (printQueueCount !== null && printQueueCount >= thresholds.print_queue_warning_count))) {'
)
replace_once(
    mdm_path,
    '  if (input.runtime.drawer_queue_busy || input.runtime.last_error?.toLowerCase().includes("drawer")) {',
    '  if (shouldEvaluatePeripheralHealth && (input.runtime.drawer_queue_busy || input.runtime.last_error?.toLowerCase().includes("drawer"))) {'
)

client_path = "apps/backoffice-web/src/lib/pos/device-heartbeat-client.ts"
replace_once(client_path, '      latency_ms: Date.now() - startedAt,', '      latency_ms: null,')
replace_once(
    client_path,
    '''      source: `web_pos_session_heartbeat_${surface}`,
      reason,
      app_url: typeof location === "undefined" ? null : location.origin
''',
    '''      source: `web_pos_session_heartbeat_${surface}`,
      telemetry_profile: surface,
      reason,
      heartbeat_uptime_ms: Math.max(0, Date.now() - startedAt),
      app_url: typeof location === "undefined" ? null : location.origin
'''
)

test_path = Path("apps/backoffice-web/tests/unit/device-mdm-diagnostics.test.ts")
test_path.write_text('''import { describe, expect, it } from "vitest";
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
''', encoding="utf-8")

checkpoint = '''## 2026-08-11 — MDM telemetry profile hardening

- MDM health derivation now distinguishes Windows Runtime, Android, and plain browser heartbeat profiles before evaluating runtime/peripheral incidents.
- Browser/Android heartbeats no longer produce false `runtime_offline`, `local_bridge_offline`, `printer_missing`, `printer_error`, print-queue, or drawer incidents when those telemetry capabilities are not present.
- Windows Runtime heartbeat behavior remains strict: Local Bridge, printer, print queue, and drawer failures still generate MDM incidents.
- Browser heartbeat no longer writes page uptime into `latency_ms`; uptime is retained separately as `metadata.heartbeat_uptime_ms` and `latency_ms` stays unknown until a real network RTT measurement exists.
- Added unit regression coverage for browser, Android, and Windows Runtime MDM profiles.
'''

for docs_path in ("README.md", "context.md"):
    text = read(docs_path).rstrip()
    if "## 2026-08-11 — MDM telemetry profile hardening" not in text:
        text = f"{text}\n\n{checkpoint.rstrip()}\n"
    else:
        text = f"{text}\n"
    write(docs_path, text)
