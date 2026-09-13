import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const route = source("../../src/app/api/android-pos/mdm/heartbeat/route.ts");
const bridge = source("../../src/lib/android-pos/it-mdm-bridge.ts");
const androidDiagnostics = source("../../../pos-android/app/src/main/java/com/cpipos/pos/AndroidDiagnostics.kt");
const androidAgent = source("../../../pos-android/app/src/main/java/com/cpipos/pos/PosMdmAgent.kt");

describe("Android IT MDM bridge", () => {
  it("keeps the Android device on the existing server heartbeat and writes operational state server-side", () => {
    expect(route).toContain("syncAndroidHeartbeatToItPlane");
    expect(route).toContain('operational_plane: "CpiPOS-002"');
    expect(route).toContain("[android-pos-mdm][it-plane] sync failed");
    expect(bridge).toContain('from("it_device_health_latest")');
    expect(bridge).toContain('from("it_device_health_snapshots")');
    expect(bridge).toContain('from("it_device_incidents")');
    expect(bridge).toContain('from("it_device_commands")');
  });

  it("reports real Android CPU, memory and storage diagnostics instead of synthetic values", () => {
    expect(androidDiagnostics).toContain("fun processCpuPercent()");
    expect(androidDiagnostics).toContain("fun memoryPercent()");
    expect(androidDiagnostics).toContain("fun totalStorageMb()");
    expect(androidDiagnostics).toContain("fun storageUsedPercent()");
    expect(androidAgent).toContain('put("cpu_percent", diagnostics.processCpuPercent())');
    expect(androidAgent).toContain('put("memory_percent", diagnostics.memoryPercent())');
    expect(androidAgent).toContain('put("total_storage_mb", diagnostics.totalStorageMb())');
    expect(androidAgent).toContain('put("storage_used_percent", diagnostics.storageUsedPercent())');
  });

  it("uses authoritative paired scope and never lets the Android client choose CpiPOS-002", () => {
    expect(route).toContain("findAutoScope(installId)");
    expect(bridge).toContain("getTrialSupabaseServiceClient()");
    expect(androidAgent).not.toContain("SUPABASE_SERVICE_ROLE");
    expect(androidAgent).not.toContain("IT_SUPABASE");
  });

  it("maps safe IT commands to the existing Android allowlist and persists ACK in result.execution_status", () => {
    expect(bridge).toContain('commandType === "request_diagnostics_bundle"');
    expect(bridge).toContain('return "collect_diagnostics"');
    expect(bridge).toContain('commandType === "reload_ui"');
    expect(bridge).toContain('return "reload_webview"');
    expect(bridge).toContain('commandType === "test_printer"');
    expect(bridge).toContain('return "test_printer_connection"');
    expect(bridge).toContain("execution_status: executionStatus");
    expect(bridge).toContain('.eq("status", "delivered")');
  });

  it("does not rely on a non-existent synced_at column on it_device_commands", () => {
    const commandSection = bridge.slice(bridge.indexOf("async function deliver("), bridge.indexOf("export async function syncAndroidHeartbeatToItPlane"));
    expect(commandSection).not.toContain("synced_at");
  });
});
