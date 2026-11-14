import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyPosEntryDenial } from "../../src/lib/server/pos-entry-denial-reasons";

const read=(path:string)=>readFileSync(resolve(process.cwd(),"src",path),"utf8");
const proxy=read("proxy.ts");
const login=read("app/login/store/page.tsx");
const devices=read("app/login/devices/page-content.tsx");

describe("POS login recovery and two-month paid access",()=>{
  it("does not cache an anonymous pre-login POS redirect",()=>{
    expect(proxy).toContain('loginUrl.searchParams.set("from", "pos-session")');
    expect(proxy).toContain('response.headers.set("Cache-Control", "private, no-store, max-age=0")');
    expect(login).toContain('get("from") === "pos-session"');
    expect(login).toContain('window.location.replace("/preview/pos")');
    expect(devices).not.toContain('warmRoute(router, "/preview/pos")');
    expect(devices).toContain("window.location.assign(consumePosReturnPath(redirectTo))");
  });
  it("retains sales access in a verified paid grace period even if the invoice is overdue",()=>{
    const paidContract={status:"active",ended_at:"2026-11-13T00:00:00Z",package_id:"growth"};
    const paidGrace={
      lifecycle_status:"grace",access_locked:false,lock_reason:"subscription_payment_grace",
      trial_expires_at:null,subscription_expires_at:"2026-11-13T00:00:00Z",
      grace_until:"2027-01-13T00:00:00Z",metadata:null
    };
    expect(classifyPosEntryDenial(paidContract,paidGrace,Date.parse("2026-11-14T05:00:00Z"))).toBeNull();
    expect(classifyPosEntryDenial(paidContract,paidGrace,Date.parse("2027-01-13T00:01:00Z"))?.code).toBe("subscription_expired");
  });
  it("still blocks expired free trials after seven days",()=>{
    const freeTrial={status:"trial",ended_at:"2026-11-07T00:00:00Z",package_id:"growth"};
    const lifecycle={lifecycle_status:"trial",access_locked:false,lock_reason:null,
      trial_expires_at:"2026-11-07T00:00:00Z",subscription_expires_at:null,grace_until:null,metadata:null};
    expect(classifyPosEntryDenial(freeTrial,lifecycle,Date.parse("2026-11-14T00:00:00Z"))?.code).toBe("trial_expired");
  });
});

import { hasVerifiedPaidGraceAccess } from "../../src/lib/paid-grace-feature-access";

const featureGate = read("lib/feature-gate.ts");
const pageGuard = read("lib/pos-page-guard.ts");

describe("paid grace feature gate does not loop back to login", () => {
  const contract = { status: "active", ended_at: "2026-11-13T00:00:00Z" };
  const paidGrace = {
    lifecycle_status: "grace", access_locked: false,
    lock_reason: "subscription_payment_grace", expires_at: "2027-01-13T00:00:00Z"
  };
  const inGrace = Date.parse("2026-11-14T05:00:00Z");

  it("honors the verified two-month paid grace after the invoice date", () => {
    expect(hasVerifiedPaidGraceAccess(contract, paidGrace, inGrace)).toBe(true);
    expect(hasVerifiedPaidGraceAccess(contract, paidGrace, Date.parse("2027-01-13T00:00:00Z"))).toBe(false);
  });
  it("never extends an expired trial or locked, rejected, missing, or invalid grace", () => {
    expect(hasVerifiedPaidGraceAccess({ ...contract, status: "trial" }, paidGrace, inGrace)).toBe(false);
    expect(hasVerifiedPaidGraceAccess({ ...contract, status: "suspended" }, paidGrace, inGrace)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(contract, { ...paidGrace, access_locked: true }, inGrace)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(contract, { ...paidGrace, lock_reason: "subscription_payment_rejected" }, inGrace)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(contract, { ...paidGrace, lifecycle_status: "expired" }, inGrace)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(contract, { ...paidGrace, expires_at: null }, inGrace)).toBe(false);
    expect(hasVerifiedPaidGraceAccess(contract, null, inGrace)).toBe(false);
  });
  it("requires billing-runtime authorization without bypassing feature grants", () => {
    expect(featureGate).toContain('from("tenant_subscription_runtime")');
    expect(featureGate).toContain('if (!await contractAllowsAccess(contract))');
    expect(featureGate).toContain("hasVerifiedPaidGraceAccess(contract, data)");
    expect(featureGate).toContain("enabled = tenantOverride.is_enabled");
    expect(featureGate).toContain("enabled = branchOverride.is_enabled");
    expect(featureGate).toContain('if (contract.status === "trial") return false');
  });
  it("redirects only invalid sessions, never transient feature errors or denied features", () => {
    expect(pageGuard).toContain("error instanceof PosGuardError && error.status === 401");
    expect(pageGuard).toContain("from=pos-session");
    expect(pageGuard).toContain('error.code === "feature_not_enabled"');
    expect(pageGuard).toContain("notFound()");
    expect(pageGuard).toContain("throw error;");
    expect(pageGuard).not.toContain("redirect(fallbackPath)");
  });
});
