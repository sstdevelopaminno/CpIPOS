import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const service=read("src/lib/server/recycling-history-reports.ts");
const view=read("src/components/pos/recycling-history-reports.tsx");
describe("CUSTOM Recycling independent history reports",()=>{
 it("routes only authorized CUSTOM Recycling, leaving ordinary POS reports untouched",()=>{
  for(const name of ["sales-summary","receipts","product-sales"]){
   const p=read("src/app/preview/pos/"+name+"/page.tsx");
   expect(p).toContain("isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)");
   expect(p).toContain("<RecyclingHistoryReports");
   expect(p).toContain("authorizeOpticalMoreMenu");
  }
 });
 it("reads finance snapshots only within tenant and permitted branch scope",()=>{
  expect(service).toContain('getRecyclingStockBranches(scope)');
  expect(service).toContain('eq("tenant_id",scope.session.tenant_id)');
  expect(service).toContain('.in("branch_id",ids)');
  expect(service).toContain('["posted","voided"]');
  expect(service).toContain('recycling_report_branch_denied');
  expect(service).toContain('recycling_report_narrow_period_required');
  expect(service).not.toContain('.from("orders")');
 });
 it("separates buys, sales, paid, credited and VOID without negative sales",()=>{
  expect(service).toContain('if(row.status==="voided")');
  expect(service).toContain('result.buyMinor+=amount');
  expect(service).toContain('result.sellMinor+=amount');
  expect(service).toContain('cashOutMinor');
  expect(service).toContain('transferInMinor');
  expect(service).toContain('creditOutMinor');
  expect(view).toContain("ไม่รวมกับรายการขายของ POS ทั่วไป");
 });
 it("uses material snapshots and routes historical receipt to existing 58/80 print path",()=>{
  expect(service).toContain('.from("recycling_transaction_lines")');
  expect(service).toContain("original_quantity");
  expect(service).toContain("sku_snapshot");
  expect(view).toContain("/preview/pos/recycling/receipts/");
  expect(view).toContain("เข้าสู่สาขาต้นทางเพื่อพิมพ์");
  expect(view).toContain('r.status==="voided"');
 });
});
