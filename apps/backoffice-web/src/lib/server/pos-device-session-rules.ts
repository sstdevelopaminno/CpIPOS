import "server-only";

type DeviceSessionAccessInput = {
  activeSessionUserId?: string | null;
  employeeUserId: string;
  employeePermissions: string[];
};

export type DeviceSessionAccessDecision =
  | {
      ok: true;
      shouldRevokeExistingSession: boolean;
      overrideApplied: boolean;
    }
  | {
      ok: false;
      code: "device_in_use";
      status: 409;
      message: string;
    };

export function canOverrideInUseDevice(permissions: string[]) {
  return permissions.includes("pos.device.override_in_use");
}

export function resolveDeviceSessionAccess(input: DeviceSessionAccessInput): DeviceSessionAccessDecision {
  const activeSessionUserId = String(input.activeSessionUserId ?? "").trim();
  if (!activeSessionUserId) {
    return { ok: true, shouldRevokeExistingSession: false, overrideApplied: false };
  }

  const canOverride = canOverrideInUseDevice(input.employeePermissions);

  // Owner/manager override is additive, not destructive. An authorized owner or
  // manager may enter the same physical POS while a cashier session remains
  // active; the existing cashier must not be logged out as a side effect.
  // Database uniqueness for active device sessions is scoped to non-override
  // frontline roles by the accompanying migration.
  if (canOverride) {
    return {
      ok: true,
      shouldRevokeExistingSession: false,
      overrideApplied: activeSessionUserId !== input.employeeUserId
    };
  }

  if (activeSessionUserId === input.employeeUserId) {
    // A normal cashier re-entering the same device replaces only their stale/current
    // session so the one-frontline-session-per-device rule stays deterministic.
    return { ok: true, shouldRevokeExistingSession: true, overrideApplied: false };
  }

  return {
    ok: false,
    code: "device_in_use",
    status: 409,
    message: "เครื่องนี้ยังมีผู้ใช้งานค้างอยู่ พนักงานขายต้องเลือกเครื่องอื่น หรือให้ผู้จัดการ/เจ้าของร้านเข้าแทน"
  };
}
