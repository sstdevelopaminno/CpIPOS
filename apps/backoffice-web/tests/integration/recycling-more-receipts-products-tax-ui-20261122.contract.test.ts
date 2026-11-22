import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const history=read("src/components/pos/recycling-history-reports.tsx");
const receiptModal=read("src/components/pos/recycling-receipt-dialog.tsx");
const receiptAction=read("src/components/pos/recycling-report-document-action.tsx");
const printSummary=read("src/components/pos/recycling-summary-print-button.tsx");
const tax=read("src/components/pos/recycling-tax-invoice-register.tsx");
const taxRoute=read("src/app/preview/pos/tax-invoices/page.tsx");
const receiptsRoute=read("src/app/preview/pos/receipts/page.tsx");
const productsRoute=read("src/app/preview/pos/product-sales/page.tsx");
const summaryRoute=read("src/app/preview/pos/sales-summary/page.tsx");
const taxApi=read("src/app/api/pos/tax-invoices/route.ts");
const cashier=read("src/components/pos/recycling-pos-workspace.tsx");
const profileRegistry=read("src/components/pos-preview/pos-tax-invoice-workspace.tsx");
const receiptPreviewApi=read("src/app/api/pos/recycling/receipts/[id]/preview/route.ts");
const css=read("src/app/globals.css");

describe("CUSTOM Recycling more-menu pages 58/80 printing and UI isolation",()=>{
 it("receipts, product sales and tax register fill the POS program frame",()=>{
  expect(history).toContain('"recycling-history-layout"');
  expect(history).toContain('flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto bg-white');
  expect(history).toContain('data-testid="recycling-history-receipts-table"');
  expect(history).toContain('data-testid="recycling-history-products-table"');
  expect(tax).toContain('data-testid="recycling-tax-invoice-register"');
  expect(tax).toContain('recycling-tax-register-layout flex h-full min-h-0 w-full');
  expect(css).toContain('.pos-app-content-area:has(> .recycling-history-layout)');
  expect(css).toContain('.pos-app-content-area:has(> .recycling-tax-register-layout)');
  expect(css).toContain('padding: 0 !important;');
  expect(history).not.toContain('mx-auto w-full max-w-[1450px]');
  expect(history).not.toContain('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm');
 });
 it("does not link from Recycling reports into ordinary sales mode",()=>{
  expect(history).not.toContain('ดูรายงานโหมดขายทั่วไป');
  expect(history).not.toContain('report_mode=standard');
  expect(tax).not.toContain('report_mode=standard');
  // Standard routes remain available only under their original server gates.
  expect(receiptsRoute).toContain('<PosReceiptsWorkspace');
  expect(productsRoute).toContain('<ProductSalesWorkspace');
  expect(summaryRoute).toContain('<PosSalesSummaryDashboard');
 });
 it("receipt and material product actions open the original authorized receipt in an in-page modal",()=>{
  expect(history).toContain('<RecyclingReportDocumentAction transactionId={r.id}');
  expect(history).toContain('<RecyclingReportDocumentAction transactionId={t.id}');
  expect(history).toContain('r.branch_id===report.sessionBranchId');
  expect(history).toContain('t.branch_id===report.sessionBranchId');
  expect(history).not.toContain('href={"/preview/pos/recycling/receipts/"+encodeURIComponent(r.id)}');
  expect(receiptAction).toContain('onClick={()=>setOpen(true)}');
  expect(receiptAction).toContain('<RecyclingReceiptDialog open={open}');
  expect(receiptModal).toContain('data-testid="recycling-print-a5"');
  expect(receiptModal).toContain('data-testid="recycling-print-a4"');
  expect(receiptPreviewApi).toContain('"a4"');
  expect(receiptPreviewApi).toContain('@page { size: ${paper==="a4"?"A4":"A5"} portrait;');
  expect(receiptModal).toContain('RecyclingPrintReceiptButton');
  expect(receiptModal).toContain('["80","80 มม."]');
  expect(receiptModal).toContain('["58","58 มม."]');
 });
 it("summary printing opens a confirmation modal; no Print Agent job until second click",()=>{
  expect(printSummary).toContain('data-testid="recycling-summary-print-open"');
  expect(printSummary).toContain('data-testid="recycling-summary-print-confirm"');
  expect(printSummary).toContain('data-testid="recycling-summary-print-final"');
  expect(printSummary).toContain('onClick={()=>void run()}');
  expect(printSummary).toContain('if(!open||busy||attempted)return;');
  expect(printSummary).toContain('"/api/pos/recycling/reports/print"');
  expect(printSummary).toContain('request_id:crypto.randomUUID()');
  expect(printSummary).not.toContain('window.location');
 });
 it("tax invoice view is Recycling-specific and cannot issue a false VAT invoice",()=>{
  expect(taxRoute).toContain('isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)');
  expect(taxRoute).toContain('<RecyclingTaxInvoiceRegister scope={posMenuScope}');
  expect(taxRoute).toContain('<PosTaxInvoiceWorkspace');
  expect(tax).toContain('loadRecyclingHistoryReport(scope,"receipts",{...search,period:search?.period??"month",direction:"sell",include_material_search:true})');
  expect(taxRoute).toContain('registryOnly');
  expect(profileRegistry).toContain('registryOnly');
  expect(tax).toContain('ชื่อวัสดุ / SKU');
  expect(tax).toContain('view=profiles');
   // The yellow warning panel is removed; transaction-level status remains visible.
   expect(tax).not.toContain('เงื่อนไขก่อนออกใบกำกับภาษี');
   expect(tax).not.toContain('border-amber-200 bg-amber-50 px-4 py-3');
   expect(tax).toContain('ทะเบียนนี้เป็นรายการตรวจสอบภายใน');
   expect(tax).toContain('ไม่บันทึก VAT เพิ่ม');
  expect(tax).toContain('ยังไม่ยืนยันการออกใบกำกับภาษี');
  expect(tax).toContain('<RecyclingReportDocumentAction transactionId={t.id}');
  expect(tax).toContain('t.branch_id===report.sessionBranchId');
  expect(tax).not.toContain('action: "print_invoice"');
  expect(tax).not.toContain('pos_tax_invoices');
  expect(tax).not.toContain('.insert(');
  expect(tax).not.toContain('.update(');
  expect(taxApi).toContain('.from("orders")');
  expect(taxApi).not.toContain('.from("recycling_transactions")');
  expect(cashier).not.toContain('บันทึกรายการสำเร็จ หมายเลขอ้างอิง');
  expect(cashier).toContain('setReceiptDialogOpen(true);');
  expect(cashier).toContain('autoPrintNotice={printNotice}');
 });
});
