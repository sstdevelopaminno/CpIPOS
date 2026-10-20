import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {buildOpticalPickupBarcode,parseOpticalBillRecallCode} from "@/lib/optical/optical-deposit-contract";
import {opticalCode128Svg} from "@/lib/optical/optical-code128-barcode";
import {renderOpticalDepositReceipt80mm} from "@/lib/optical/optical-deposit-receipt-80mm";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const id="123e4567-e89b-12d3-a456-426614174000";
describe("Optical pickup, due date and barcode contracts",()=>{
 it("round trips the compact one-dimensional pickup barcode with authorized locator parser",()=>{
  const code=buildOpticalPickupBarcode(id);
  expect(code).toMatch(/^OP[0-9A-Z]{25}$/);
  expect(parseOpticalBillRecallCode(code!)).toBe(id);
  expect(parseOpticalBillRecallCode("CPI-OPTICAL-RECALL:1:"+id)).toBe(id);
  expect(parseOpticalBillRecallCode("OPZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBeNull();
 });
 it("encodes a valid Code 128B with start and stop elements",()=>{
  const svg=opticalCode128Svg("OP0000000000000000000000000");
  expect(svg).toMatch(/viewBox="0 0 [0-9]+ 65"/);
  expect(svg).toContain('<rect');
  expect(()=>opticalCode128Svg("❌")).toThrow();
 });
 it("prints partial AND full paid Thermal receipts in 58mm/80mm with barcode and due date",()=>{
  const bill={tenantId:id,branchId:id,orderId:id,currencyCode:"LAK" as const,totalAmount:50000,paidAmount:35000,status:"partially_paid" as const};
  const base={bill,receiptNumber:"OPT-001",storeName:"IMDC OPTICAL",branchName:"สาขาหลัก",createdAtIso:"2026-10-20T10:00:00Z",cashierName:"Cashier",paymentMethod:"cash" as const,
    pickupDateIso:"2026-10-28T05:00:00Z",items:[{description:"แว่นกันแดด",quantity:1,lineTotal:50000}]};
  const partial=renderOpticalDepositReceipt80mm({...base,receiptWidthMm:58});
  expect(partial).toContain("58mm auto");
  expect(partial).toContain('class="barcode"');
  expect(partial).toContain("2026-10-28");
  expect(partial).not.toContain('class="qr"');
  const paid=renderOpticalDepositReceipt80mm({...base,bill:{...bill,paidAmount:50000,status:"paid"},receiptWidthMm:80});
  expect(paid).toContain("ใบเสร็จชำระเต็มจำนวน");
  expect(paid).toContain("80mm auto");
 });
 it("requires date in deposit dialog and atomic server RPC, never changes ordinary checkout",()=>{
  const dialog=src("src/components/pos/pos-optical-deposit-dialog.tsx");
  const route=src("src/app/api/pos/optical/deposits/route.ts");
  const sale=src("src/components/pos/pos-sales-module.tsx");
  expect(dialog).toContain('id="optical-pickup-date"');
  expect(route).toContain('rpc("optical_open_with_deposit_due_v1"');
  expect(route).toContain("p_due_date:body.due_date");
  expect(sale).toContain("due_date:dueDate");
 });
 it("recalls against server scoped order without recording payment on scan",()=>{
  const scanner=src("src/components/pos/pos-general-sale-table-controller.tsx");
  const recall=src("src/app/api/pos/optical/work-orders/recall/route.ts");
  const modal=src("src/components/pos/pos-optical-pickup-balance-dialog.tsx");
  expect(scanner).toContain("cpipos:optical-pickup-recalled");
  expect(recall).toContain('.eq("tenant_id",scope.session.tenant_id)');
  expect(recall).toContain('"optical_bill_not_collectable"');
  expect(modal).toContain("/payments");
  expect(modal).toContain("crypto.randomUUID()");
 });
 it("enforces audited owner/manager PIN and blocks deletion of posted money",()=>{
  const api=src("src/app/api/pos/optical/work-orders/manage/route.ts");
  const dialog=src("src/components/pos/pos-optical-work-order-detail-dialog.tsx");
  const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261020181000_optical_work_order_manager_pin_v2.sql"),"utf8");
  expect(api).toContain('rpc("optical_manage_work_order_pin_v2"');
  expect(dialog).toContain('manager_pin:managerPin');
  expect(dialog).toContain('md:grid-cols-2');
  expect(sql).toContain("extensions.crypt");
  expect(sql).toContain("OPTICAL_REFUND_REQUIRED_BEFORE_CANCELLATION");
  expect(sql).toContain("optical_transition_work_order_tx");
  expect(sql).not.toContain("delete from public.optical_payment_ledger");
 });
});
