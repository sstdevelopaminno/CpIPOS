import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const source=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");

describe("three POS languages and legacy QR preservation",()=>{
 it("forwards selected language into users and printer settings",()=>{
  const settings=source("components/pos-preview/pos-settings-workspace.tsx");
  const adapter=source("components/backoffice/printers-module.tsx");
  expect(settings).toContain("<PosUsersModule lang={lang} embedded");
  expect(settings).toContain("<PrintersModule lang={lang}");
  expect(adapter).toContain("return <PrinterConnectionManagerV3 lang={lang} />");
 });
 it("localizes filter popups, the extra panels and empty reports",()=>{
  const summary=source("components/pos-preview/pos-sales-summary-dashboard.tsx");
  expect(summary).toContain('title={lang==="en"?"More details":ui("ดูเพิ่มเติม")}');
  expect(summary).toContain('lang==="en"?"From date":ui("ตั้งแต่")');
  expect(summary).toContain('>{lang==="en"?({payments:"Payment methods"');
  expect(summary).toContain("status === \"completed\"");
  expect(summary).toContain('if(lang==="lo")');
 });
 it("keeps QR image and PromptPay routes intact, changing only labels and discount currency",()=>{
  const sales=source("components/pos/pos-sales-module.tsx");
  expect(sales).toContain('activePaymentQrMode === "qr_image"');
  expect(sales).toContain("paymentAccount.qr_image_url");
  expect(sales).toContain('activePaymentQrMode === "qr_image" ? paymentAccount?.qr_image_url');
  expect(sales).toContain("posCurrencyCode");
  expect(sales).toContain("discountAmountLabel:");
  expect(sales).toContain('lang==="lo" ? `ສ່ວນຫຼຸດ');
 });
 it("keeps printer discovery while translating labels",()=>{
  const printers=source("components/backoffice/printer-connection-manager-v3.tsx");
  expect(printers).toContain("const printerText");
  expect(printers).toContain("const tr=");
  expect(printers).toContain('"/api/backoffice/printers/devices"');
  expect(printers).toContain('"/api/backoffice/printers/discover');
 });
});