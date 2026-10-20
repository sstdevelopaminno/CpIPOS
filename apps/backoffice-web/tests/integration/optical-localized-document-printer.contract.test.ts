import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {renderOpticalDepositReceipt80mm} from "@/lib/optical/optical-deposit-receipt-80mm";
import {opticalReceiptLabels,opticalReceiptDate} from "@/lib/optical/optical-receipt-i18n";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const uuid="11111111-1111-4111-8111-111111111111";
const input={
 bill:{tenantId:uuid,branchId:uuid,orderId:uuid,currencyCode:"LAK" as const,
 totalAmount:50000,paidAmount:35000,status:"partially_paid" as const},
 receiptNumber:"000001",documentReceiptNumber:"000001",documentBillNumber:"000012",
 storeName:"IMDC OPTICAL",branchName:"Main",
 cashierName:"Test cashier",storeLogoUrl:"https://example.org/logo.png",
 storeAddress:"123 Main Road",storePhone:"020-0000",
 createdAtIso:"2026-10-20T06:50:40Z",paymentMethod:"cash" as const,
 items:[{description:"Frames",quantity:1,lineTotal:50000}]
};
describe("Optical numeric documents, store profile, and three-language receipts",()=>{
 it("prints a numeric bill and receipt number without exposing the internal uuid in the header",()=>{
  const html=renderOpticalDepositReceipt80mm(input);
  expect(html).toContain("เลขที่ใบเสร็จ: 000001");
  expect(html).toContain("เลขบิล: 000012");
  expect(html).toContain('class="store-logo"');
  expect(html).toContain("123 Main Road");
  expect(html).toContain("020-0000");
  expect(html).toContain('class="barcode"');
  expect(html).not.toContain("เลขบิล: "+uuid);
 });
 it("switches all receipt labels, not only UI, to English and Lao",()=>{
  const en=renderOpticalDepositReceipt80mm({...input,language:"en"});
  expect(en).toContain("Deposit receipt");
  expect(en).toContain("Bill No.: 000012");
  expect(en).toContain("Balance due");
  expect(en).toContain("Work order barcode");
  expect(en).not.toContain("บาร์โค้ดใบสั่งงาน");
  const lo=renderOpticalDepositReceipt80mm({...input,language:"lo"});
  expect(lo).toContain("ໃບຮັບເງິນມັດຈຳ");
  expect(lo).toContain("ເລກບິນ: 000012");
  expect(lo).toContain("ຍອດຄ້າງຊຳລະ");
  expect(opticalReceiptLabels("th").cash).toBe("เงินสด");
  expect(opticalReceiptDate(input.createdAtIso,"en")).toBeTruthy();
 });
 it("escapes shop profile fields and rejects javascript logo schemes",()=>{
  const html=renderOpticalDepositReceipt80mm({...input,storeLogoUrl:"javascript:alert(1)",storeAddress:"<script>alert(1)</script>"});
  expect(html).not.toContain('<img class="store-logo"');
  expect(html).toContain("&lt;script&gt;");
 });
 it("uses original receipt/print routing and supports optical work order purpose",()=>{
  const route=src("src/app/api/pos/optical/work-orders/[workOrderId]/deposit-receipt/route.ts");
  const printRoute=src("src/app/api/pos/optical/work-orders/[workOrderId]/print/route.ts");
  const printerApi=src("src/app/api/backoffice/printers/devices/route.ts");
  const printerUi=src("src/components/backoffice/printer-connection-manager-v3.tsx");
  expect(route).toContain("optical_document_numbers");
  expect(route).toContain("loadReceiptStoreProfile");
  expect(route).toContain("getCurrentLanguage()");
  expect(printRoute).toContain('purpose:"work_order",fallbackPurposes:["receipt"]');
  expect(printerApi).toContain("printer_purpose_incompatible_with_mode");
  expect(printerUi).toContain('activeSection==="overview"');
  expect(printerUi).toContain('activeSection==="history"');
  expect(printerUi).toContain('p.value!=="work_order"');
  expect(printerUi).toContain('["kitchen","drink","bar"]');
 });
 it("generates immutable per-branch document sequences without changing posted money",()=>{
  const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261020200000_optical_stable_document_numbers_v1.sql"),"utf8");
  expect(sql).toContain("primary key(kind,source_id)");
  expect(sql).toContain("unique(tenant_id,branch_id,kind,document_number)");
  expect(sql).toContain("after insert on public.optical_payment_ledger");
  expect(sql).not.toContain("update public.optical_payment_ledger");
  expect(sql).not.toContain("delete from");
 });
});
