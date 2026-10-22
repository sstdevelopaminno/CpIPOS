import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {opticalStockText} from "../../src/lib/optical-stock-i18n";
const read=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");
describe("CUSTOM Optical: three languages, currency history and scrolling",()=>{
 it("translates inventory tabs, forms and popup actions while leaving tenant business values unchanged",()=>{
  for(const label of ["สต๊อกกรอบแว่นและเลนส์","เลือกสาขาสต๊อก","เพิ่มสินค้า","แก้ไขสินค้า","สร้างสินค้าหลายรายการ","ราคา (","ชื่อสินค้า *","บันทึกทั้งหมด","ยืนยันการลบสินค้า","ดูรหัส","จำนวนคงเหลือ","ปิด"]){
    expect(opticalStockText("en",label)).not.toBe(label);
    expect(opticalStockText("lo",label)).not.toBe(label);
    expect(opticalStockText("th",label)).toBe(label);
  }
  const page=read("app/preview/pos/stock/custom/page.tsx");
  const ui=read("components/pos/optical-stock-workspace.tsx");
  expect(page).toContain("getCurrentLanguage()");
  expect(page).toContain("lang={lang}");
  expect(ui).toContain("opticalStockText(lang,thai)");
  expect(ui).toContain("overflow-y-auto overscroll-y-contain");
  expect(ui).toContain("max-h-[min(62vh,720px)] overflow-auto");
 });
 it("preserves explicitly persisted receipt currency and marks only Optical legacy missing snapshots unknown",()=>{
  const route=read("app/api/pos/receipts/route.ts");
  const ui=read("components/pos-preview/pos-receipts-workspace.tsx");
  expect(route).toContain('opticalCurrencyAudit?"UNKNOWN":"THB"');
  expect(route).toContain('readMetadataString(row.metadata, "currency_code")');
  expect(route).toContain("byCurrency.UNKNOWN");
  expect(route).toContain("byCurrency.USD");
  expect(ui).toContain('record.currencyCode==="UNKNOWN"');
  expect(ui).toContain('currencyCode === "LAK" ? "₭" : record.currencyCode === "THB" ? "฿"');
  expect(ui).toContain("max-h-[min(62dvh,650px)]");
 });
 it("keeps unknown history outside real THB and LAK report totals",()=>{
  const srv=read("lib/services/pos-sales-summary-service.ts");
  const report=read("components/pos-preview/pos-sales-summary-dashboard.tsx");
  expect(srv).toContain('opticalCurrencyAudit?"UNKNOWN":"THB"');
  expect(srv).toContain('order.metadata?.currency_code===currencyCode');
  expect(srv).toContain('currencyBuckets');
  expect(report).toContain('bucket.currencyCode==="UNKNOWN"');
  expect(report).toContain('data-testid="sales-summary-currency-ledger"');
 });
});
