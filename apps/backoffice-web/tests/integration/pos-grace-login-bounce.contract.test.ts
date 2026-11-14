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
