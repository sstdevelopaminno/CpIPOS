import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const route = source("../../src/app/api/android-pos/mdm/heartbeat/route.ts");
const transport = source("../../src/lib/android-pos/full-mdm-transport.ts");
const androidDiagnostics = source("../../../pos-android/app/src/main/java/com/cpipos/pos/AndroidDiagnostics.kt");
const androidAgent = source("../../../pos-android/app/src/main/java/com/cpipos/pos/PosMdmAgent.kt");
const fullMdmAgent = source("../../../pos-android/app/src/main/java/com/cpipos/pos/FullMdmAgent.kt");

describe("Android POS MDM primary control plane", () => {
  it("keeps POS and Full MDM on CpiPOS-001 without a secondary runtime dependency", () => {
    expect(route).toContain("syncFullMdmHeartbeat");
    expect(route).toContain('operational_plane: "CpiPOS-001"');
    expect(route).toContain('authority: "CpiPOS-001.mdm_commands"');
    expect(route).not.toContain("syncAndroidHeartbeatToItPlane");
    expect(route).not.toContain("CpiPOS-002");

    expect(transport).toContain("getPrimarySupabaseServiceClient()");
    expect(transport).toContain('.from("mdm_devices")');
    expect(transport).toContain('.from("mdm_commands")');
    expect(transport).toContain('.from("mdm_command_audit")');
    expect(transport).not.toContain("getTrialSupabaseServiceClient");
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

  it("uses authoritative paired scope and never lets the Android client choose a database authority", () => {
    expect(route).toContain("findAutoScope(installId)");
    expect(route).toContain("getPrimarySupabaseServiceClient()");
    expect(androidAgent).not.toContain("SUPABASE_SERVICE_ROLE");
    expect(androidAgent).not.toContain("IT_SUPABASE");
    expect(fullMdmAgent).not.toContain("SUPABASE_SERVICE_ROLE");
    expect(fullMdmAgent).not.toContain("SUPABASE_URL");
  });

  it("delivers Full MDM commands server-side and persists execution acknowledgements", () => {
    expect(transport).toContain('"diagnostics_ping"');
    expect(transport).toContain('"sync_policy"');
    expect(transport).toContain('"lock_device"');
    expect(transport).toContain('status: "picked_up"');
    expect(transport).toContain('completed_at: nowIso');
    expect(transport).toContain('event_type: "device_result"');
    expect(androidAgent).toContain('.put("full_mdm_results", fullMdmAgent.pendingResults())');
  });

  it("advertises remote lock only when the native Device Owner executor is available", () => {
    expect(fullMdmAgent).toContain('if (deviceOwner) capabilities.put("remote_lock")');
    expect(fullMdmAgent).toContain("manager.lockNow()");
    expect(fullMdmAgent).not.toContain('capabilities.put("remote_unlock")');
    expect(fullMdmAgent).not.toContain('capabilities.put("financing_lock")');
    expect(fullMdmAgent).not.toContain('capabilities.put("revoke_access")');
    expect(fullMdmAgent).not.toContain('capabilities.put("app_uninstall")');
  });
});
