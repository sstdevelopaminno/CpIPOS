import { describe, expect, it } from "vitest";
import { isFinancePackageAllowed } from "../../src/lib/finance-package-policy";

const active = { contractStatus: "active", endedAt: "2099-01-01T00:00:00.000Z", runtime: null };

describe("Finance package entitlements", () => {
  it("enables only Business and CUSTOM, never lower or unknown tiers", () => {
    for (const packageCode of ["business", "Business", "custom", "CUSTOM"]) {
      expect(isFinancePackageAllowed({ ...active, packageCode })).toBe(true);
    }
    for (const packageCode of ["starter", "growth", "solo", null, "enterprise"]) {
      expect(isFinancePackageAllowed({ ...active, packageCode })).toBe(false);
    }
  });
  it("denies suspended and expired trials, and locked subscriptions", () => {
    expect(isFinancePackageAllowed({ ...active, packageCode: "business", contractStatus: "suspended" })).toBe(false);
    expect(isFinancePackageAllowed({ ...active, packageCode: "business", contractStatus: "trial", endedAt: "2025-01-01" })).toBe(false);
    expect(isFinancePackageAllowed({
      ...active, packageCode: "custom",
      runtime: { lifecycle_status: "active", access_locked: true, lock_reason: "locked", expires_at: null }
    })).toBe(false);
  });
  it("allows expired paid access only within verified grace, never by date alone", () => {
    const expired = { ...active, packageCode: "business", endedAt: "2026-10-01T00:00:00.000Z", now: Date.parse("2026-11-16T00:00:00.000Z") };
    expect(isFinancePackageAllowed(expired)).toBe(false);
    expect(isFinancePackageAllowed({
      ...expired, runtime: { lifecycle_status: "grace", access_locked: false, lock_reason: "subscription_payment_grace", expires_at: "2026-12-01T00:00:00.000Z" }
    })).toBe(true);
    expect(isFinancePackageAllowed({
      ...expired, runtime: { lifecycle_status: "grace", access_locked: false, lock_reason: "subscription_payment_grace", expires_at: "2026-11-01T00:00:00.000Z" }
    })).toBe(false);
  });
});
