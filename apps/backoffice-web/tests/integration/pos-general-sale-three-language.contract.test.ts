import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generalSaleUi } from "../../src/lib/pos-general-sale-i18n";
const read=(path:string)=>readFileSync(new URL("../../src/"+path, import.meta.url),"utf8");

describe("POS scanner/table and printer Thai English Lao UI",()=>{
 it("includes real translated copy for all three languages and all required sale keys",()=>{
   const th=generalSaleUi.th, en=generalSaleUi.en, lo=generalSaleUi.lo;
   expect(Object.keys(en).sort()).toEqual(Object.keys(th).sort());
   expect(Object.keys(lo).sort()).toEqual(Object.keys(th).sort());
   for(const key of Object.keys(th) as Array<keyof typeof th>){
     const value=lo[key];
     if(typeof value !== "string"){
       expect(value.length).toBeGreaterThan(0);
       for(const text of value)expect(text).not.toMatch(/[ก-๙]/);
     }else{
       expect(value).toBeTruthy();
       expect(value).not.toMatch(/[ก-๙]/);
     }
   }
   expect(lo.add).toBe("ເພີ່ມສິນຄ້າ");
   expect(en.add).toBe("Add item");
   expect(th.add).toBe("เพิ่มสินค้า");
   expect(lo.opticalPlaceholder).toContain("ບາໂຄດ");
   expect(lo.empty).toContain("ຍັງບໍ່ມີສິນຄ້າ");
 });
 it("passes authoritative language to imperative SKU scan UI; never reads document.lang as a binary flag",()=>{
   const page=read("app/preview/pos/page.tsx");
   const table=read("components/pos/pos-general-sale-table-controller.tsx");
   expect(page).toContain("<PosGeneralSaleTableController lang={lang} />");
   expect(table).toContain("generalSaleUi[lang]");
   expect(table).toContain("input.placeholder = opticalActive ? copy.opticalPlaceholder : copy.groceryPlaceholder");
   expect(table).toContain("empty.textContent = copy.empty");
   expect(table).toContain("const headers = copy.headers");
   expect(table).toContain("billInput.placeholder = copy.billPlaceholder");
   expect(table).toContain("}, [lang]);");
   expect(table).not.toContain("document.documentElement.lang.toLowerCase()");
 });
 it("translates remaining printer actions, headings, hints and placeholders in both English and Lao",()=>{
   const p=read("components/backoffice/printer-connection-manager-v3.tsx");
   expect(p).toContain("missingPrinterText[value]?.[lang]");
   for(const key of ["+ เพิ่มเครื่องพิมพ์","รายการเครื่องพิมพ์ ","⚙ ตั้งค่าขั้นสูง / ผูกเครื่อง POS","เช่น เคาน์เตอร์ 1, ครัวร้อน","ระบบล็อก physical fingerprint"]) {
     expect(p).toContain(key);
   }
   expect(p).toContain('tr("+ เพิ่มเครื่องพิมพ์")');
   expect(p).toContain('tr("กำลังเชื่อมต่อ...")');
   expect(p).toContain('tr("ไม่ได้เลือกโซน: ใช้เป็นเส้นทางสำรองของทั้งสาขา")');
 });
 it("leaves payment QR provider, currency and transfer/receipt logic unchanged",()=>{
   const sales=read("components/pos/pos-sales-module.tsx");
   expect(sales).toContain('activePaymentQrMode === "qr_image"');
   expect(sales).toContain('paymentAccount.qr_image_url');
   expect(sales).toContain('posCurrencyCode === "THB"');
   const controller=read("components/pos/pos-general-sale-table-controller.tsx");
   expect(controller).toContain("/api/pos/products/lookup?sku=");
 });
});
