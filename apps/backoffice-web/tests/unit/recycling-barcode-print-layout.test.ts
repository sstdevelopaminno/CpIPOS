import {describe,expect,it} from "vitest";
import {renderRecyclingBarcodeLabel,recyclingBarcodePrintDimensions} from "@/lib/recycling-barcode-print-layout";
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
 it("offers four real-width label sizes with Code128 quiet zones and safe 58/80mm limits",()=>{
  const sku="0002555599";
  for(const paper of [58,80] as const){
   const small=recyclingBarcodePrintDimensions(sku,paper,"small");
   const medium=recyclingBarcodePrintDimensions(sku,paper,"medium");
   const large=recyclingBarcodePrintDimensions(sku,paper,"large");
   const full=recyclingBarcodePrintDimensions(sku,paper,"full");
   expect(small.widthMm).toBeLessThan(medium.widthMm);
   expect(medium.widthMm).toBeLessThanOrEqual(large.widthMm);
   expect(large.widthMm).toBeLessThanOrEqual(full.widthMm);
   expect(full.widthMm).toBeLessThanOrEqual(paper===80?64:44);
   expect(full.widthMm/full.modules).toBeGreaterThanOrEqual(0.20);
   const html=renderRecyclingBarcodeLabel({sku,name:"เหล็กแท่ง",branchName:"สาขาหลัก",paper,size:"large",centerOnPaper:true});
   expect(html).toContain('width:'+large.widthMm.toFixed(2)+'mm;max-width');
   expect(html).toContain('margin-left:'+(paper===80?8:7)+'mm');
   expect(html).toContain('role="img"');
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
