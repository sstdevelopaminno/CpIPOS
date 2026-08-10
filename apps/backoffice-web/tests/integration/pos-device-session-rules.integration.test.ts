import { describe, expect, it } from "vitest";
import { resolveDeviceSessionAccess } from "@/lib/server/pos-device-session-rules";

describe("POS device session access rules", () => {
  it("allows the same staff user to re-enter their active device after a login interruption", () => {
    const result = resolveDeviceSessionAccess({
      activeSessionUserId: "staff-1",
      employeeUserId: "staff-1",
      employeePermissions: ["pos.sales.access", "pos.shift.open"]
    });

    expect(result).toEqual({
      ok: true,
      shouldRevokeExistingSession: true,
      overrideApplied: false
    });
  });

  it("blocks another staff user from entering a device that still belongs to someone else", () => {
    const result = resolveDeviceSessionAccess({
      activeSessionUserId: "staff-1",
      employeeUserId: "staff-2",
      employeePermissions: ["pos.sales.access", "pos.shift.open"]
    });

    expect(result).toMatchObject({
      ok: false,
      code: "device_in_use",
      status: 409
    });
  });

  it("allows manager or owner permissions to take over an in-use device and revoke the old session", () => {
    const result = resolveDeviceSessionAccess({
      activeSessionUserId: "staff-1",
      employeeUserId: "manager-1",
      employeePermissions: ["pos.sales.access", "pos.device.override_in_use"]
    });

    expect(result).toEqual({
      ok: true,
      shouldRevokeExistingSession: true,
      overrideApplied: true
    });
  });

  it("allows a manager to refresh their own active device session without treating it as takeover", () => {
    const result = resolveDeviceSessionAccess({
      activeSessionUserId: "manager-1",
      employeeUserId: "manager-1",
      employeePermissions: ["pos.sales.access", "pos.device.override_in_use"]
    });

    expect(result).toEqual({
      ok: true,
      shouldRevokeExistingSession: true,
      overrideApplied: false
    });
  });
});
