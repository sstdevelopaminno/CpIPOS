import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {classifyPosEntryDenial,unavailablePosFeatureDenial} from "@/lib/server/pos-entry-denial-reasons";
import {loginFlowText} from "@/lib/pre-entry-language";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const date="2026-10-20T00:00:00.000Z";
describe("POS device chooser subscription diagnostics",()=>{
 it("distinguishes expired trial from payment overdue and from feature entitlement",()=>{
  const e=classifyPosEntryDenial(
    {status:"trial",ended_at:date,package_id:"growth"},
    {lifecycle_status:"trial",access_locked:false,lock_reason:null,trial_expires_at:date,
     subscription_expires_at:null,grace_until:null},
    Date.parse("2026-10-20T04:00:00Z")
  );
  expect(e?.code).toBe("trial_expired");
  expect(e?.kind).toBe("subscription");
  expect(e?.expires_at).toBe(date);
  expect(e?.message).not.toContain("ค้างชำระ");
  expect(unavailablePosFeatureDenial().code).toBe("feature_not_enabled");
 });
 it("does not block paid growth packages that remain within their term",()=>{
  const result=classifyPosEntryDenial(
    {status:"active",ended_at:"2026-10-26T00:00:00Z"},
    {lifecycle_status:"active",access_locked:false,lock_reason:null,trial_expires_at:null,
     subscription_expires_at:"2026-10-26T00:00:00Z",grace_until:null},
    Date.parse("2026-10-20T04:00:00Z")
  );
  expect(result).toBeNull();
 });
 it("checks subscription lifecycle before sales feature, never auto-unlocks expired tenant",()=>{
  const access=src("src/lib/server/pos-entry-access-service.ts");
  const order=access.indexOf("const lifecycleDenial=classifyPosEntryDenial");
  const feature=access.indexOf("const enabled=await hasAnyPosSalesFeature");
  expect(order).toBeGreaterThan(0);
  expect(feature).toBeGreaterThan(order);
  expect(access).toContain("if(lifecycleDenial && !temporary)return {allowed:false");
  const route=src("src/app/api/auth/devices/select/select-handler.ts");
  expect(route).toContain("evaluatePosEntryAccess(supabase, flow.tenantId, flow.branchId)");
  expect(route).toContain("if(!entryAccess.allowed)");
  expect(route).toContain("expires_at:detail.expires_at");
 });
 it("preflights terminal chooser and suppresses auto-selection while package is invalid",()=>{
  const api=src("src/app/api/auth/devices/route.ts");
  const page=src("src/app/login/devices/page-content.tsx");
  expect(api).toContain("evaluatePosEntryAccess(supabase,flow.tenantId,flow.branchId)");
  expect(api).toContain("auto_select_single_device:entryAccess.allowed");
  expect(api).toContain("entry_access:entryAccess.allowed");
  expect(api).toContain('private, no-store, max-age=0');
  expect(page).toContain("setEntryBlocked(true)");
  expect(page).toContain("setPopup({type:\"error\",message:denial.message");
  expect(page).toContain("data.entry_access?.allowed!==false && data.auto_select_single_device");
  expect(page).toContain("const selectedDeviceCanOpen = !entryBlocked");
  expect(page).toContain('router.push("/login/package-payment")');
  expect(page).toContain('grid-cols-3 gap-2');
  expect(page).toContain('T(popup.code && PACKAGE_PAYMENT_REASONS.has(popup.code) ? "ชำระเงิน" : "ตรวจสอบอีกครั้ง")');
  expect(page).toContain('paymentReview');
  expect(page).toContain('cpipos_checkout_store_code');
  expect(page).toContain('ระบบได้รับสลิปแล้ว');
  expect(page).toContain('ฝ่าย IT ตั้งเป้าตรวจสอบภายใน 3 วัน');
  expect(page).toContain('!text-white');
  expect(page).toContain("entryExpiryDate(lang,popup.expiresAt)");
  expect(page).toContain("/login/support-chat");
  const deviceRoute=src("src/app/api/auth/devices/route.ts");
  expect(deviceRoute).toContain('payment_review: entryAccess.allowed ? null : paymentReview');
  expect(deviceRoute).toContain('.not("evidence_url", "is", null)');
 });

 it("reuses authorized public package checkout without unlocking the sales terminal on slip submission",()=>{
  const page=src("src/app/login/package-payment/page.tsx");
  const payment=src("src/lib/services/public-package-checkout-service.ts");
  const itGate=src("src/lib/server/pos-entry-access-service.ts");
  expect(page).toContain('"/api/auth/subscription-checkout"');
  expect(page).toContain('"/api/auth/subscription-checkout"');
  expect(page).toContain('setSubmitted(body.data)');
  expect(page).toContain('quote.pending_review');
  expect(payment).toContain('status: "pending"');
  expect(payment).toContain('pending_review: openReview ?');
  expect(payment).toContain('currency: "THB"');
  expect(itGate).toContain("classifyPosEntryDenial");
  expect(page).not.toContain('access_locked:false');
 });

 it("shows package diagnostics in Thai, Lao and English",()=>{
  expect(loginFlowText("lo","แพ็กเกจทดลองใช้งานสิ้นสุดแล้ว")).toContain("ໝົດອາຍຸ");
  expect(loginFlowText("en","แพ็กเกจสิ้นสุดระยะเวลาใช้งานแล้ว")).toContain("expired");
  expect(loginFlowText("lo","ตรวจสอบอีกครั้ง")).toBe("ກວດສອບອີກຄັ້ງ");
 });
});
