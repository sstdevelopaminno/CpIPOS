import { describe, expect, it } from "vitest";
import { resolveDeviceSessionAccess } from "@/lib/server/pos-device-session-rules";

describe("resolveDeviceSessionAccess", () => {
  it("allows a free device without revoking anything", () => {
    expect(
      resolveDeviceSessionAccess({
        activeSessionUserId: null,
        employeeUserId: "user-1",
        employeePermissions: []
      })
    ).toEqual({ ok: true, shouldRevokeExistingSession: false, overrideApplied: false });
  });

  it("recycles an existing session when the same employee re-enters the same device", () => {
    expect(
      resolveDeviceSessionAccess({
        activeSessionUserId: "user-1",
        employeeUserId: "user-1",
        employeePermissions: []
      })
    ).toEqual({ ok: true, shouldRevokeExistingSession: true, overrideApplied: false });
  });

  it("blocks a different employee without device override permission", () => {
    expect(
      resolveDeviceSessionAccess({
        activeSessionUserId: "user-1",
        employeeUserId: "user-2",
        employeePermissions: ["pos.sales.access"]
      })
    ).toMatchObject({ ok: false, code: "device_in_use", status: 409 });
  });

  it("allows manager or owner takeover when RBAC grants device override permission", () => {
    expect(
      resolveDeviceSessionAccess({
        activeSessionUserId: "user-1",
        employeeUserId: "user-2",
        employeePermissions: ["pos.sales.access", "pos.device.override_in_use"]
      })
    ).toEqual({ ok: true, shouldRevokeExistingSession: true, overrideApplied: true });
  });
});
