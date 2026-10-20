import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const src=(path:string)=>readFileSync(new URL("../../src/"+path,import.meta.url),"utf8");
describe("Optical deposit search, safe bank transfer and SKU navigation",()=>{
 it("searches the full branch customer registry by name or code, not just a client-side first-page list",()=>{
  const modal=src("components/pos/pos-optical-deposit-dialog.tsx");
  const api=src("app/api/pos/optical/customers/route.ts");
  expect(modal).toContain("customerQuery");
  expect(modal).toContain("type=\"search\"");
  expect(modal).toContain('qs.set("q",customerQuery.trim())');
  expect(api).toContain("customer_code.ilike");
  expect(api).toContain("full_name.ilike");
  expect(api).toContain('scope.session.branch_id');
 });
 it("transfers to the deposit amount display without auto-settling real money",()=>{
  const modal=src("components/pos/pos-optical-deposit-dialog.tsx");
  const api=src("app/api/pos/optical/deposits/route.ts");
  expect(modal).toContain('setStep("transfer")');
  expect(modal).toContain("money(amount??0)");
  expect(modal).toContain("ยังไม่บันทึกรับเงินจริง");
  expect(modal).not.toContain("setManagerVerified");
  expect(modal).not.toContain('data-testid="optical-bank-reference"');
  expect(api).toContain("optical_transfer_proof_required");
  expect(api).toContain('requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit")');
 });
 it("shows Optical SKU without cart navigation arrows on both rendering paths",()=>{
  const c=src("components/pos/pos-general-sale-table-controller.tsx");
  const sale=src("components/pos/pos-sales-module.tsx");
  expect(c).toContain("SKU / รหัสสินค้า: ");
  expect(c).toContain("if (opticalActive) tr.append(nameCell, qtyCell, unitPriceCell, totalCell, actionCell)");
  expect(c).toContain("overflow-x: auto !important");
  expect(c).not.toContain("cpipos-sd-table__nav");
  expect(c).not.toContain("เลื่อนตารางเพื่อดูข้อมูล");
  expect(c).not.toContain("scroll.scrollBy({left:");
  expect(sale).toContain("max-w-full overflow-x-auto overscroll-x-contain");
  expect(sale).not.toContain("เลื่อนตะกร้าเพื่อดูข้อมูล");
  expect(sale).not.toContain("opticalCartScrollRef");
  expect(sale).not.toContain("Scroll cart right");
 });
});
