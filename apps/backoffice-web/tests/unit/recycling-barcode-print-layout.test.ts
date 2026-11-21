import {describe,expect,it} from "vitest";
import {renderRecyclingBarcodeLabel} from "@/lib/recycling-barcode-print-layout";
describe("Recycling barcode thermal printing",()=>{
 it("renders Code128 with quiet zones in 58/80 mm without creating a receipt",()=>{
  for(const paper of [58,80] as const){
   const html=renderRecyclingBarcodeLabel({sku:"155858",name:"กระดาษ",branchName:"สาขาหลัก",paper});
   expect(html).toContain("viewBox");
   expect(html).toContain("@page{size:"+paper+"mm auto");
   expect(html).toContain("155858");
   expect(html).toContain("กระดาษ");
   expect(html).toContain("ไม่ใช่ใบเสร็จ");
  }
 });
 it("escapes material names and prevents overly dense / invalid barcode output",()=>{
  const html=renderRecyclingBarcodeLabel({sku:"AB-123",name:'<img src=x>',branchName:"X&Y",paper:80});
  expect(html).toContain("&lt;img src=x&gt;");
  expect(html).toContain("X&amp;Y");
  expect(html).not.toContain('<img src=x>');
  expect(()=>renderRecyclingBarcodeLabel({sku:"A".repeat(59),name:"long",branchName:"A",paper:58}))
   .toThrow("recycling_barcode_too_wide_for_paper");
  expect(()=>renderRecyclingBarcodeLabel({sku:"วัสดุ",name:"test",branchName:"A",paper:58}))
   .toThrow("optical_barcode_invalid_text");
 });
});
