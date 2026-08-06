import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHeartbeatPayload, executePendingActions } from "../src/lib/device-heartbeat-client";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("mobile device heartbeat payload", () => {
  it("builds a payload with the mobile source tag", () => {
    const payload = buildHeartbeatPayload({
      deviceCode: "STAFF-01",
      machineId: "mob-test-machine",
      startedAt: Date.now(),
      reason: "startup"
    });

    expect(payload.identity.device_code).toBe("STAFF-01");
    expect(payload.identity.machine_id).toBe("mob-test-machine");
    expect(payload.metadata.source).toBe("cpipos_mobile_web_heartbeat");
    expect(payload.metadata.reason).toBe("startup");
    expect(typeof payload.captured_at).toBe("string");
  });
});

describe("mobile executePendingActions", () => {
  it("marks clear_print_queue/restart_local_bridge as not applied (no local bridge on mobile)", () => {
    const results = executePendingActions([
      { id: "1", command_type: "clear_print_queue", issued_at: "2026-08-06T00:00:00Z" },
      { id: "2", command_type: "restart_local_bridge", issued_at: "2026-08-06T00:00:00Z" }
    ]);

    expect(results).toEqual([
      { id: "1", command_type: "clear_print_queue", applied: false },
      { id: "2", command_type: "restart_local_bridge", applied: false }
    ]);
  });

  it("reloads the page for reload_ui", () => {
    const reload = vi.fn();
    (globalThis as { window?: unknown }).window = { location: { reload } };

    const results = executePendingActions([{ id: "3", command_type: "reload_ui", issued_at: "2026-08-06T00:00:00Z" }]);

    expect(results).toEqual([{ id: "3", command_type: "reload_ui", applied: true }]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("acknowledges disable_device/enable_device/request_diagnostics_bundle as already satisfied", () => {
    const results = executePendingActions([
      { id: "4", command_type: "disable_device", issued_at: "2026-08-06T00:00:00Z" },
      { id: "5", command_type: "enable_device", issued_at: "2026-08-06T00:00:00Z" },
      { id: "6", command_type: "request_diagnostics_bundle", issued_at: "2026-08-06T00:00:00Z" }
    ]);

    expect(results.every((result) => result.applied)).toBe(true);
  });
});
