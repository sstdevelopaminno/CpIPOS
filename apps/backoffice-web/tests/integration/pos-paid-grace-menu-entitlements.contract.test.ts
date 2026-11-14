import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasVerifiedPaidGraceAccess } from "../../src/lib/paid-grace-feature-access";

const read = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");
const api = read("app/api/pos/features/route.ts");
const gate = read("lib/feature-gate.ts");
const more = read("components/pos-preview/pos-more-workspace.tsx");

describe("POS feature snapshot keeps purchased entitlements during paid grace", () => {
  const now = Date.parse("2026-11-14T04:00:00Z");
  const paidContract = { status: "active", ended_at: "2026-11-13T00:00:00Z" };
  const activeGrace = {
    lifecycle_status: "grace",
    access_locked: false,
    lock_reason: "subscription_payment_grace",
    expires_at: "2027-01-13T00:00:00Z"
  };

  for (const plan of ["starter", "growth", "business", "custom"]) {
    for (const cadence of ["monthly", "yearly"]) {
      it(`preserves ${plan} purchased feature gates during a verified ${cadence} payment grace window`, () => {
        // Payment cycle / package are intentionally not used to decide grace;
        // the existing package feature matrix is still applied per tenant.
        expect(hasVerifiedPaidGraceAccess(paidContract, activeGrace, now)).toBe(true);
      });
    }
  }

  it("shares the same verified paid grace authority as the server route gate", () => {
    expect(api).toContain('from("tenant_subscription_runtime")');
    expect(api).toContain('hasVerifiedPaidGraceAccess({ status: contract.status ?? "", ended_at: contract.ended_at }, runtime)');
    expect(api).toContain("!await contractAllowsAccess(tenantId, contract ?? null)");
    expect(gate).toContain("hasVerifiedPaidGraceAccess(contract, data)");
    expect(api).not.toContain("!contractAllowsAccess(contract ?? null)");
  });

  it("retains Growth and other package grants, including IT and branch denials", () => {
    expect(api).toContain('from("subscription_package_features")');
    expect(api).toContain('from("tenant_feature_subscriptions")');
    expect(api).toContain("if (tenantOverrides.has(feature)) enabled = tenantOverrides.get(feature) ?? false");
    expect(api).toContain("if (branchOverrides.has(feature)) enabled = branchOverrides.get(feature) ?? false");
    expect(more).toContain("const locked = menuLocked || isLocked(item.href)");
  });

  it("never treats an expired trial or prohibited paid state as free access", () => {
    expect(api).toContain('if (contract.status === "trial") return false');
    expect(hasVerifiedPaidGraceAccess({ status: "trial", ended_at: paidContract.ended_at }, activeGrace, now)).toBe(false);
    expect(hasVerifiedPaidGraceAccess({ status: "cancelled", ended_at: paidContract.ended_at }, activeGrace, now)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(paidContract, { ...activeGrace, access_locked: true }, now)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(paidContract, { ...activeGrace, lock_reason: "subscription_payment_rejected" }, now)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(paidContract, { ...activeGrace, lifecycle_status: "expired" }, now)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(paidContract, null, now)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(paidContract, activeGrace, Date.parse(activeGrace.expires_at))).toBe(false);
  });

  it("shows retryable failure rather than reporting zero package features on runtime lookup errors", () => {
    expect(api).toContain('if (error) throw new Error("pos_menu_subscription_runtime_unavailable")');
    expect(more).toContain("setPolicyReady(false); // Fail closed");
    expect(more).toContain("setPolicyError(");
  });
});
