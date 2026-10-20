import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {classifyPosEntryDenial,unavailablePosFeatureDenial} from "@/lib/server/pos-entry-denial-reasons";
const files=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const now=Date.parse("2026-10-20T09:55:00Z");
const baseLifecycle={
 lifecycle_status:"trial",access_locked:false,lock_reason:null,
 trial_expires_at:"2026-10-20T00:00:00Z",subscription_expires_at:null,grace_until:null,
 metadata:null
};
describe("Cashier terminal subscription reason and safe error popups",()=>{
 it("shows expired trial—not unsupported POS features or assumed unpaid status—for a Growth trial ending on October 20",()=>{
  const answer=classifyPosEntryDenial({status:"trial",ended_at:"2026-10-20T00:00:00Z"},baseLifecycle,now);
  expect(answer?.code).toBe("trial_expired");
  expect(answer?.title).toBe("แพ็กเกจทดลองใช้งานสิ้นสุดแล้ว");
  expect(answer?.expires_at).toBe("2026-10-20T00:00:00Z");
  expect(answer?.kind).toBe("subscription");
  expect(answer?.message).not.toContain("ไม่ชำระ");
 });
 it("does not lock valid paid Growth contracts, even if an old trial date has expired",()=>{
  const active={...baseLifecycle,lifecycle_status:"active",trial_expires_at:"2026-10-01T00:00:00Z",subscription_expires_at:"2026-10-26T00:00:00Z"};
  expect(classifyPosEntryDenial({status:"active",ended_at:"2026-10-26T00:00:00Z"},active,now)).toBeNull();
 });
 it("does not automatically renew a nonpaying or expired paid subscription",()=>{
  const expired={...baseLifecycle,lifecycle_status:"active",trial_expires_at:null,subscription_expires_at:"2026-10-19T00:00:00Z"};
  const denial=classifyPosEntryDenial({status:"active",ended_at:"2026-10-19T00:00:00Z"},expired,now);
  expect(denial?.code).toBe("subscription_expired");
  expect(denial?.expires_at).toBe("2026-10-19T00:00:00Z");
 });
 it("keeps temporary locks and genuinely missing packages distinct from trial expiry",()=>{
  expect(classifyPosEntryDenial({status:"active",ended_at:null},{...baseLifecycle,lifecycle_status:"active",access_locked:true,trial_expires_at:null},now)?.code).toBe("subscription_locked");
  expect(classifyPosEntryDenial(null,{...baseLifecycle,lifecycle_status:"active",trial_expires_at:null},now)?.code).toBe("subscription_missing");
  expect(unavailablePosFeatureDenial().code).toBe("feature_not_enabled");
 });
 it("requires server verification independently of branch feature overrides",()=>{
  const handler=files("app/api/auth/devices/select/select-handler.ts");
  expect(handler).toContain("classifyPosEntryDenial(subscription.contract,subscription.lifecycle)");
  expect(handler).toContain("if(denial||!posSalesEnabled)");
  expect(handler).toContain('code:detail.code,message:detail.message,title:detail.title');
  expect(handler).toContain('"feature_verification_unavailable"');
  expect(handler).not.toContain('return timedJsonError(403, "feature_not_enabled", "แพ็กเกจปัจจุบันยังไม่รองรับการเข้าใช้งานหน้าขาย")');
 });
 it("displays the relevant expiry popup in Thai Lao and English with support and no implicit payment approval",()=>{
  const ui=files("app/login/devices/page-content.tsx");
  const locale=files("lib/pre-entry-language.ts");
  expect(ui).toContain('PACKAGE_ENTRY_REASONS.has(popup.code)');
  expect(ui).toContain('T(entryErrorTitle(popup.code))');
  expect(ui).toContain('entryExpiryDate(lang,popup.expiresAt)');
  expect(ui).toContain("https://lin.ee/f1LXpAF");
  expect(locale).toContain('"แพ็กเกจทดลองใช้งานสิ้นสุดแล้ว"');
  expect(locale).toContain('"แพ็กเกจสิ้นสุดระยะเวลาใช้งานแล้ว"');
  expect(locale).toContain('"ไม่พบสิทธิ์ใช้งานหน้าขายในแพ็กเกจหรือสาขานี้');
  expect(ui).not.toContain('grantProvisionalAccess');
 });
});
