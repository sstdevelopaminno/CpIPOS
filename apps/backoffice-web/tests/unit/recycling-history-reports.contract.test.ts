import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const service=read("src/lib/server/recycling-history-reports.ts");
const view=read("src/components/pos/recycling-history-reports.tsx");
const finance=read("src/lib/recycling-report-calculation.ts");
describe("CUSTOM Recycling independent history reports",()=>{
 it("routes only authorized CUSTOM Recycling, leaving ordinary POS reports untouched",()=>{
  for(const name of ["sales-summary","receipts","product-sales"]){
   const p=read("src/app/preview/pos/"+name+"/page.tsx");
   expect(p).toContain("isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)");
   expect(p).toContain("<RecyclingHistoryReports");
   expect(p).toContain("authorizeOpticalMoreMenu");
   expect(p).toContain("isAuthorizedCustomGeneralSaleTenant");
   expect(p).toContain('requestedMode === "standard"');
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
  expect(finance).toContain('if(row.status==="voided")');
  expect(finance).toContain('result.buyMinor+=amount');
  expect(finance).toContain('result.sellMinor+=amount');
  expect(finance).toContain('cashOutMinor');
  expect(finance).toContain('transferInMinor');
  expect(finance).toContain('creditOutMinor');
  expect(view).toContain("ไม่รวมกับรายการขายของ POS ทั่วไป");
  expect(view).not.toContain("ดูรายงานโหมดขายทั่วไป");
  expect(view).not.toContain("report_mode=standard");
 });
 it("uses material snapshots and routes historical receipt to existing 58/80 print path",()=>{
  expect(service).toContain('.from("recycling_transaction_lines")');
  expect(service).toContain("original_quantity");
  expect(service).toContain("sku_snapshot");
  expect(service).toContain("matchingLineIds");
  expect(view).toContain("ค้นหาบิล / วัสดุ / SKU");
  expect(view).toContain("RecyclingReportDocumentAction");
  expect(view).toContain("transactionId={r.id}");
  expect(view).toContain("transactionId={t.id}");
  expect(read("src/components/pos/recycling-report-document-action.tsx")).toContain("<RecyclingReceiptDialog");
  expect(view).toContain("เข้าสู่สาขาต้นทางเพื่อพิมพ์");
  expect(view).toContain('r.status==="voided"');
 });
});
