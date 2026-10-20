import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {classifyPosEntryDenial} from "@/lib/server/pos-entry-denial-reasons";
const src=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("Pre-entry subscription provisional activation",()=>{
 it("keeps canonical outstanding and permits attaching a slip to the same IT-created pending request",()=>{
  const service=src("lib/services/public-package-checkout-service.ts");
  const page=src("app/login/package-payment/page.tsx");
  expect(service).toContain("request.source===\"it_tenant_control\"");
  expect(service).toContain("request.status===\"pending\"");
  expect(service).toContain("!request.has_evidence");
  expect(service).toContain("request.package_id===snapshot.contract.package_id");
  expect(service).toContain("due?.open_request_id===request.id");
  expect(service).toContain("Math.abs(previousAmount-dueAmount)<0.01");
  expect(service).toContain("pending_request_id:activeRequest.id");
  expect(service).toContain("amount:expected ?? snapshot.contract.amount_per_cycle ?? 0");
  expect(service).toContain("completingExisting ? payload.pending_request_id!");
  expect(service).toContain('.eq("tenant_id",payload.tenant_id)');
  expect(service).toContain('.is("evidence_url",null).is("amount_reported",null)');
  expect(service).toContain('source: completingExisting ? "it_tenant_control"');
  expect(page).toContain('quote.package.name');
  expect(page).toContain('t.packagePrice');
  expect(page).toContain('t.continuity');
  expect(page).toContain('quote.pending_review?.has_evidence');
  expect(page).toContain('setModal(true)');
  expect(page).not.toContain('href="/preview/pos/payments/package?entry=subscription"');
 });
 it("rejects reusing a pending slip or an unrelated IT request instead of double billing",()=>{
  const source=src("lib/services/public-package-checkout-service.ts");
  expect(source).toContain('original.evidence_url || original.amount_reported!=null');
  expect(source).toContain('original.id!==payload.pending_request_id');
  expect(source).toContain('original.requested_package_id!==target.id');
  expect(source).toContain('original.metadata?.source!=="it_tenant_control"');
  expect(source).toContain('pendingPreEntryEvidenceEligible(snapshot,scoped)');
  expect(source).toContain('throw new Error("open_request_exists")');
 });
 it("routes expired-device Pay to the canonical POS single-item package menu without granting a cashier session",()=>{
  const proxy=readFileSync(resolve(process.cwd(),"src/proxy.ts"),"utf8");
  const devices=src("app/login/devices/page-content.tsx");
  const preentry=src("app/login/package-payment/page.tsx");
  const mainMenu=src("components/pos-preview/pos-staff-menu.tsx");
  const canonical=src("app/preview/pos/payments/package/page.tsx");
  expect(devices).toContain('router.push("/preview/pos/payments/package?entry=subscription")');
  expect(proxy).toContain('pathname === "/preview/pos/payments/package"');
  expect(proxy).toContain('request.nextUrl.searchParams.get("entry") === "subscription" || !hasPosSession');
  expect(proxy).toContain('NextResponse.rewrite(checkoutUrl)');
  expect(proxy).toContain('"/preview/pos/payments/package",');
  expect(proxy).not.toContain('pathname.startsWith("/preview/pos") && !hasPosSession');
  expect(preentry).toContain('menu:"ชำระแพ็กเกจ"');
  expect(preentry).toContain('aria-current="page"');
  expect(preentry).toContain('"/api/auth/subscription-checkout"');
  expect(mainMenu).toContain('href="/preview/pos/payments/package"');
  expect(canonical).toContain('await requirePosSession()');
 });
 it("reuses signed employee context and never asks for store or PIN again",()=>{
  const route=src("app/api/auth/subscription-checkout/route.ts");
  const page=src("app/login/package-payment/page.tsx");
  expect(route).toContain('readPreEntryFlowState');
  expect(route).toContain('["employee_verified"]');
  expect(route).toContain("authenticatedContext");
  expect(page).toContain('/api/auth/subscription-checkout');
  expect(page).not.toContain("setPin(");
  expect(page).not.toContain("setStoreCode(");
  expect(page).toContain("quote?.package.amount");
 });
 it("shows IT-configured bank details and QR, uploads slip only on submission",()=>{
  const page=src("app/login/package-payment/page.tsx");
  const quote=src("lib/services/public-package-checkout-service.ts");
  expect(page).toContain("quote.qr_data_url");
  expect(page).toContain("bank?.account_number");
  expect(page).toContain("form.append(\"slip\",slip)");
  expect(quote).toContain("billing_cycle_id:due.billing_cycle_id");
  expect(quote).toContain('subscription_support_required');
 });
 it("uses existing scan-verified SQL grace grant with strict per-tenant 3-day cutoff",()=>{
  const quote=src("lib/services/public-package-checkout-service.ts");
  const api=src("lib/server/pos-entry-access-service.ts");
  const session=src("lib/pos-session-guard.ts");
  expect(quote).toContain('rpc("grant_provisional_subscription_access"');
  expect(quote).toContain('slipScan.model!=="mock"');
  expect(quote).toContain('provisional_access_granted:provisional?.granted===true');
  expect(api).toContain('eq("status","under_review")');
  expect(api).toContain('eq("auto_check_status","passed")');
  expect(api).toContain('gt("provisional_access_expires_at",new Date().toISOString())');
  expect(session).toContain('subscription_payment_review_timeout');
  expect(session).toContain('Math.min(expiryAt,Date.parse(recent.data.provisional_access_expires_at))');
 });
 it("shows non-approval popup on rejection or timeout",()=>{
  const lifecycle={lifecycle_status:"expired",access_locked:true,lock_reason:"subscription_payment_review_timeout",
    trial_expires_at:"2026-10-17T00:00:00Z",subscription_expires_at:null,grace_until:null,metadata:null};
  const denial=classifyPosEntryDenial({status:"trial",ended_at:"2026-10-17T00:00:00Z"},lifecycle);
  expect(denial?.code).toBe("subscription_review_timeout");
  expect(denial?.message).toContain("ติดต่อ Support");
  expect(src("app/login/devices/page-content.tsx")).toContain("/login/support-chat");
 });
 it("uses the existing communication bridge while POS session is locked",()=>{
  const support=src("app/login/support-chat/page.tsx");
  const bridge=src("lib/services/support-chat/support-chat-bridge.ts");
  const component=src("components/pos-preview/pos-support-chat.tsx");
  expect(support).toContain("requirePreEntrySupport");
  expect(support).toContain("initiallyOpen");
  expect(bridge).toContain("issuePreEntrySupportChatBridge");
  expect(component).toContain('apiBase="/api/pos/support-chat"');
 });
});
