import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const svc=readFileSync(resolve(process.cwd(),"src/lib/services/public-package-checkout-service.ts"),"utf8");

describe("Locked CUSTOM shop can pay only an IT-agreed invoice from pre-entry POS",()=>{
 it("never allows a bare quote or a generic CUSTOM self-service checkout",()=>{
  expect(svc).toContain('const isCustom=current.code==="custom" || current.contact_sales===true');
  expect(svc).toContain('if(isCustom)throw new Error("subscription_support_required")');
  expect(svc).toContain('activeRequest.source==="it_custom_agreement"');
  expect(svc).toContain('request.kind==="payment_notice"');
  expect(svc).toContain('due?.open_request_id===request.id');
  expect(svc).toContain('Math.abs(previousAmount-dueAmount)<0.01');
 });
 it("accepts only the same scoped IT-agreed no-slip request and keeps provenance",()=>{
  expect(svc).toContain('payload.source==="authenticated_preentry" && payload.pending_request_id');
  expect(svc).toContain('original.metadata?.source!=="it_custom_agreement" || !original.metadata?.custom_terms_snapshot');
  expect(svc).toContain('!pendingPreEntryEvidenceEligible(snapshot,scoped)');
  expect(svc).toContain('source: completingExisting ? String(open.data?.metadata?.source??"it_tenant_control")');
  expect(svc).toContain('.eq("tenant_id",payload.tenant_id)');
  expect(svc).toContain('.eq("status","pending")');
 });
 it("still requires real server grant and leaves unmatched slips pending review",()=>{
  expect(svc).toContain('slipScan.status==="verified" && slipScan.model!=="mock"');
  expect(svc).toContain('db.rpc("grant_provisional_subscription_access"');
  expect(svc).toContain('source:"authenticated_preentry"');
 });
});