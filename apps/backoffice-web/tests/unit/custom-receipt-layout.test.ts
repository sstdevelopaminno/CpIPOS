import {describe,it,expect} from "vitest";
import {normalizeReceiptVisibility,validReceiptVisibility,receiptVisibilityFromMetadata,receiptDateText} from "../../src/lib/printing/custom-receipt-layout";
import {renderReceiptHtml} from "../../src/lib/printing/receipt-html-template";
const base={paperWidthMm:80 as const,storeName:"Test Store",branchName:"Branch A",storeAddress:"Test Address",storePhone:"0123456789",logoUrl:"https://example.org/test-logo.png",sellerName:"Test Seller",orderNo:"EX-0001",modeLabel:"Test Mode",paidAtIso:"2026-11-26T10:39:00Z",items:[{name:"Material",quantity:10,unitPrice:6.7,lineTotal:67}],discountAmount:0,totalAmount:67,paymentMethod:"cash",documentNotice:"Mandatory notice",voidWarning:"VOID must remain"};
const body=(s:string)=>s.split("<body>")[1];
describe("CUSTOM receipt layout",()=>{
 it("shows all fields by default and rejects incomplete or nonboolean saved values",()=>{
  const flags=normalizeReceiptVisibility(null);
  expect(Object.values(flags).every(Boolean)).toBe(true);
  expect(validReceiptVisibility({...flags,date:"false"})).toBe(false);
  expect(validReceiptVisibility({...flags,extra:true})).toBe(false);
  expect(validReceiptVisibility(flags)).toBe(true);
  expect(body(renderReceiptHtml(base))).toContain("EX-0001");
 });
 it("isolates settings by branch and receipt family",()=>{
  const fields={...normalizeReceiptVisibility(null),date:false};
  const metadata={custom_receipt_layout_v1:{branchA:{recycling:{fields}}}};
  expect(receiptVisibilityFromMetadata(metadata,"branchA","recycling")).toEqual(fields);
  expect(receiptVisibilityFromMetadata(metadata,"branchB","recycling")).toBeUndefined();
  expect(receiptVisibilityFromMetadata(metadata,"branchA","shared")).toBeUndefined();
 });
 it("omits hidden header fields without altering monetary rows or mandatory notices",()=>{
  const flags=normalizeReceiptVisibility(Object.fromEntries(Object.keys(normalizeReceiptVisibility(null)).map(k=>[k,false])));
  const html=body(renderReceiptHtml({...base,visibility:flags}));
  for(const s of ["Test Store","Branch A","Test Address","0123456789","Test Seller","EX-0001","Test Mode","17:39","test-logo.png","ขอบคุณที่ใช้บริการ"])expect(html).not.toContain(s);
  for(const s of ["Material","67.00","Mandatory notice","VOID must remain"])expect(html).toContain(s);
  expect(body(renderReceiptHtml({...base,visibility:flags,paymentMethod:"credit",footerText:"Credit outstanding"}))).toContain("Credit outstanding");
 });
 it("formats date and time separately in Thai time",()=>{
  const flags=normalizeReceiptVisibility(null);
  expect(receiptDateText(base.paidAtIso,{...flags,date:false})).toBe("17:39");
  expect(receiptDateText(base.paidAtIso,{...flags,time:false})).not.toContain("17:39");
  expect(receiptDateText(base.paidAtIso,{...flags,date:false,time:false})).toBe("");
 });
});
