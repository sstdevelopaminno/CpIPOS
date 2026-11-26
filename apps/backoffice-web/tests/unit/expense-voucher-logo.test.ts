import {describe,it,expect} from "vitest";
import {expenseVoucherLogoUrl} from "../../src/lib/printing/expense-voucher-logo";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
describe("expense voucher store logo",()=>{
 it("accepts configured image data and ordinary image URLs",()=>{
  for(const value of ["data:image/png;base64,AAAA","data:image/svg+xml;base64,AAAA","/brand/shop.png","https://example.com/logo.png","http://example.com/logo.png"])expect(expenseVoucherLogoUrl(value)).toBe(value);
 });
 it("rejects non-image data, credentials, protocol-relative paths and script URLs",()=>{
  for(const value of ["javascript:alert(1)","data:text/html;base64,AAAA","//example.com/logo.png","/\\example.com/logo.png","https://user:pass@example.com/logo.png",""])expect(expenseVoucherLogoUrl(value)).toBe("");
 });
 it("uses authenticated tenant profile and permits its image in print CSP",()=>{
  const route=readFileSync(resolve(process.cwd(),"src/app/api/finance/expense-voucher/[id]/route.ts"),"utf8");
  expect(route).toContain("loadReceiptStoreProfile(identity.tenantId)");
  expect(route).toContain("expenseVoucherLogoUrl(profile.logo_url)");
  expect(route).toContain("profile.display_name||profile.name");
  expect(route).toContain("profile.company_address");
  expect(route).toContain("escape(logo)");
  expect(route).toContain("img-src 'self' data: https: http:");
  expect(route).toContain("logo.naturalWidth");
 });
});
