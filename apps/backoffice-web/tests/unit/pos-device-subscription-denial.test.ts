import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {classifyPosEntryDenial,unavailablePosFeatureDenial} from "@/lib/server/pos-entry-denial-reasons";
const now=Date.parse("2026-10-20T09:50:00.000Z");
const trial=(end:string|null)=>({status:"trial",ended_at:end,package_id:"growth"});
const active=(end:string|null)=>({status:"active",ended_at:end,package_id:"growth"});
const lifecycle={
 lifecycle_status:"trial",access_locked:false,lock_reason:null,trial_expires_at:"2026-10-20T00:00:00.000Z",
 subscription_expires_at:null,grace_until:null,metadata:null
};
describe("POS cashier device selection accurately classifies customer subscription",()=>{
 it("expired Growth trial is not reported as a missing POS feature or proof of nonpayment",()=>{
  const result=classifyPosEntryDenial(trial("2026-10-20T00:00:00Z"),lifecycle,now);
  expect(result?.code).toBe("trial_expired");
  expect(result?.expires_at).toBe("2026-10-20T00:00:00Z");
  expect(result?.message).not.toContain("ไม่ชำระ");
 });
 it("active paid contract stays eligible and not accidentally blocked",()=>{
  expect(classifyPosEntryDenial(active("2026-10-26T00:00:00Z"),{
    ...lifecycle,lifecycle_status:"active",trial_expires_at:"2026-10-01T00:00:00Z",
    subscription_expires_at:"2026-10-26T00:00:00Z"
  },now)).toBeNull();
 });
 it("a converted paid contract is not treated as an expired trial when lifecycle status lags",()=>{
  expect(classifyPosEntryDenial(active("2026-11-15T00:00:00Z"),{
    ...lifecycle,lifecycle_status:"trial",trial_expires_at:"2026-10-20T00:00:00Z",
    subscription_expires_at:"2026-11-15T00:00:00Z"
  },now)).toBeNull();
 });
 it("no false subscription expiry for exempt sales demos",()=>{
  expect(classifyPosEntryDenial(active("2026-09-20T00:00:00Z"),{
    ...lifecycle,lifecycle_status:"sales_demo",access_locked:true,metadata:{quota_exempt:true}
  },now)).toBeNull();
 });
 it("distinguishes locked active subscriptions and genuinely unsupported features",()=>{
  expect(classifyPosEntryDenial(active("2026-11-15T00:00:00Z"),{
    ...lifecycle,lifecycle_status:"active",access_locked:true,trial_expires_at:null,
    subscription_expires_at:"2026-11-15T00:00:00Z"
  },now)?.code).toBe("subscription_locked");
  expect(unavailablePosFeatureDenial().code).toBe("feature_not_enabled");
 });
 it("never bypasses an expired contract when an old branch-level feature override is enabled",()=>{
  const src=readFileSync(resolve(process.cwd(),"src/app/api/auth/devices/select/select-handler.ts"),"utf8");
  const access=readFileSync(resolve(process.cwd(),"src/lib/server/pos-entry-access-service.ts"),"utf8");
  expect(access).toContain("classifyPosEntryDenial(subscription.contract,subscription.lifecycle)");
  expect(access).toContain("if(lifecycleDenial && !temporary)return {allowed:false");
  expect(src).toContain("evaluatePosEntryAccess(supabase, flow.tenantId, flow.branchId)");
  expect(src).toContain("if(!entryAccess.allowed)");
  expect(src).toContain('"feature_verification_unavailable"');
  expect(src).not.toContain('timedJsonError(403, "feature_not_enabled"');
 });
 it("shows dedicated package popup and a support option with Thai English Lao translations",()=>{
  const ui=readFileSync(resolve(process.cwd(),"src/app/login/devices/page-content.tsx"),"utf8");
  const copy=readFileSync(resolve(process.cwd(),"src/lib/pre-entry-language.ts"),"utf8");
  expect(ui).toContain("entryErrorTitle(popup.code)");
  expect(ui).toContain("entryExpiryDate(lang,popup.expiresAt)");
  expect(ui).toContain("PACKAGE_ENTRY_REASONS.has(popup.code)");
  expect(ui).toContain("/login/support-chat");
  expect(copy).toContain("ໄລຍະທົດລອງ");
  expect(copy).toContain("Trial period ended");
 });
});
