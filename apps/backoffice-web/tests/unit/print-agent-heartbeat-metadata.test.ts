import { describe, expect, it } from "vitest";
import { buildPrintAgentHeartbeatMetadata } from "@/lib/printing/print-agent-heartbeat-metadata";

describe("print agent heartbeat metadata", () => {
  it("syncs runtime version and clears stale active-state deactivation flags without losing history", () => {
    const metadata = buildPrintAgentHeartbeatMetadata({
      currentMetadata: {
        source: "android_pos_native_print_agent",
        app_version: "1.0.10",
        deactivated_at: "2026-08-15T10:21:53.631268+00:00",
        deactivated_reason: "cross_tenant_install_reassigned",
        wrong_device_model: "OldModel"
      },
      heartbeatMetadata: {
        runtime: "android_native_print_agent",
        device_model: "C20Lite",
        claim_poll_policy: "adaptive_1_2_3s"
      },
      appVersion: "1.0.11",
      isActive: true
    });

    expect(metadata).toMatchObject({
      runtime: "android_native_print_agent",
      device_model: "C20Lite",
      claim_poll_policy: "adaptive_1_2_3s",
      app_version: "1.0.11",
      last_deactivated_at: "2026-08-15T10:21:53.631268+00:00",
      last_deactivated_reason: "cross_tenant_install_reassigned",
      last_wrong_device_model: "OldModel",
      deactivated_at: null,
      deactivated_reason: null,
      wrong_device_model: null
    });
  });

  it("does not project deactivation cleanup when the caller is not active", () => {
    const metadata = buildPrintAgentHeartbeatMetadata({
      currentMetadata: { deactivated_reason: "manual" },
      heartbeatMetadata: { runtime: "test" },
      appVersion: " 1.0.11 ",
      isActive: false
    });

    expect(metadata).toEqual({ runtime: "test", app_version: "1.0.11" });
  });
  it("forwards print health deltas but suppresses unchanged health metadata", () => {
    const current = {
      runtime: "android_native_print_agent",
      print_health_state: "healthy",
      last_print_success_at_ms: 1000,
      last_print_duration_ms: 420,
      last_transport: "lan"
    };
    const unchanged = buildPrintAgentHeartbeatMetadata({
      currentMetadata: current,
      heartbeatMetadata: { ...current },
      appVersion: null,
      isActive: true
    });
    expect(unchanged).toEqual({});

    const changed = buildPrintAgentHeartbeatMetadata({
      currentMetadata: current,
      heartbeatMetadata: {
        ...current,
        print_health_state: "degraded",
        last_print_failure_at_ms: 2000,
        last_print_error: "printer_offline"
      },
      appVersion: null,
      isActive: true
    });
    expect(changed).toMatchObject({
      print_health_state: "degraded",
      last_print_failure_at_ms: 2000,
      last_print_error: "printer_offline"
    });
  });
});
