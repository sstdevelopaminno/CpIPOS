import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const src=(path:string)=>readFileSync(resolve(process.cwd(),"src",path),"utf8");
const pos=src("app/api/pos/billing/requests/route.ts");
const ui=src("components/pos-preview/pos-subscription-center.tsx");
describe("POS package slip instant activation; IT always controls settlement/rejection",()=>{
 it("keeps CUSTOM quote separate until IT has explicitly prepared a payment notice",()=>{
  expect(pos).toContain('kind === "custom_quote_request"');
  expect(pos).toContain('kind === "payment_notice" && !completingItPreparedPayment');
  expect(pos).toContain('existingById.metadata?.source==="it_custom_agreement"');
  expect(pos).toContain('canonicalDue?.open_request_id === requestKey');
 });
 it("uses canonical tenant billing cycle, exact amount, OCR dates and recipient and rejects mock",()=>{
  expect(pos).toContain("canonicalDue?.billing_cycle_id");
  expect(pos).toContain('billing_cycle_id:canonicalDue.billing_cycle_id');
  expect(pos).toContain('slipScan?.status==="verified" && slipScan.checks.passed && slipScan.model!=="mock"');
  expect(pos).toContain('target.id===snapshot.contract.package_id');
  expect(pos).toContain('Number(expectedForScan)===Number(canonicalCurrentAmount)');
  expect(pos).toContain('db.rpc("grant_provisional_subscription_access"');
  expect(pos).toContain("p_actor_id:scope.session.user_id");
  expect(pos).toContain('source:upgrading ? String(existingById?.metadata?.source');
  expect(pos).toContain('checkout_source:"pos_subscription_center"');
 });
 it("does not promise access on a verified-looking slip when server grant failed",()=>{
  expect(pos).toContain("provisional_access_granted:provisionalGranted");
  expect(pos).toContain('auto_check_status:"needs_review"');
  expect(ui).toContain("provisional_access_granted?: boolean");
  expect(ui).toContain("json.data.provisional_access_granted");
  expect(ui).toContain("ยังไม่เปิด POS อัตโนมัติ");
  expect(ui).toContain("ฝ่าย IT ยังจะตรวจเงินเข้าจริงภายหลัง");
 });
});