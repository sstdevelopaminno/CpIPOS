import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { recyclingReceiptTaxNotice, RECYCLING_RECEIPT_ACCOUNTING_NOTICE }
 from "../../src/lib/printing/recycling-tax-receipt-note";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("isolated Recycling Windows thermal, cashier layout and controlled document corrections",()=>{
 it("prints a concise contact-accounting notice ONLY on Recycling non-tax receipts",()=>{
  expect(recyclingReceiptTaxNotice(null)).toBe(
   "เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี หากต้องการใบกำกับภาษี กรุณาติดต่อฝ่ายบัญชี"
  );
  expect(RECYCLING_RECEIPT_ACCOUNTING_NOTICE).toContain("กรุณาติดต่อฝ่ายบัญชี");
  const printer=read("src/lib/printing/recycling-receipt-print-service.ts");
  expect(printer).toContain("RECYCLING_RECEIPT_ACCOUNTING_NOTICE");
  expect(printer).toContain("กรุณาติดต่อฝ่ายบัญชี");
  const normal=read("src/lib/printing/receipt-html-template.ts");
  expect(normal).not.toContain("RECYCLING_RECEIPT_ACCOUNTING_NOTICE");
 });
 it("moves mode toggles to an accessible pop-up beside material count without hiding HID scanning",()=>{
  const ui=read("src/components/pos/recycling-pos-workspace.tsx");
  expect(ui).toContain('data-testid="recycling-scanner-search-settings"');
  expect(ui).toContain('data-testid="recycling-scanner-search-settings-modal"');
  expect(ui).toContain('aria-haspopup="dialog"');
  expect(ui).toContain('setSearchPreferencesOpen(true)');
  expect(ui).toContain('onClick={()=>selectScannerMode("barcode")}');
  expect(ui).toContain('onClick={()=>selectScannerMode("name")}');
  expect(ui).toContain('if(searchPreferencesOpen)');
  expect(ui).toContain('const [searchMode,setSearchMode]=useState<"barcode"|"name">("barcode")');
  expect(ui).toContain('id="recycling-barcode" ref={scannerRef}');
  expect(ui).toContain("physicalRecyclingBarcodeKey");
  expect(ui).toContain("onKeyDown={onBarcodeKeyDown}");
  expect(ui).toContain("setCatalogPage(1)");
 });
 it("shows purchase/sale label ONLY for IT-granted Recycling CUSTOM mode",()=>{
  const side=read("src/components/pos-preview/pos-shell-sidebar.tsx");
  const menu=read("src/components/pos-preview/pos-staff-menu.tsx");
  expect(side).toContain("body?.data?.sales_modes?.recycling === true");
  expect(side).toContain("recyclingMenuAllowed={recyclingMenuAllowed}");
  expect(menu).toContain('item.key === "pos_menu_sales_list" && recyclingMenuAllowed');
  expect(menu).toContain("รายการซื้อ–ขาย");
  expect(menu).toContain("labelFor(item, lang)");
  expect(menu).toContain('"/preview/pos/sales-list"');
 });
 it("uses a scoped direct date correction RPC without an accounting approval queue",()=>{
  const api=read("src/app/api/pos/recycling/transactions/[id]/document-time/route.ts");
  const service=read("src/lib/server/recycling-document-correction-service.ts");
  const page=read("src/components/pos/recycling-sales-list-page-content.tsx");
  const ui=read("src/components/pos/recycling-sales-list-row-actions.tsx");
  const editor=read("src/components/pos/recycling-document-time-editor.tsx");
  expect(api).toContain("requirePosSession()");
  expect(api).toContain('requirePermission(scope,"sales:list:view")');
  expect(api).toContain('["owner","manager"].includes(scope.session.role)');
  expect(api).toContain("branchId:scope.session.branch_id");
  expect(api).toContain("tenantId:scope.session.tenant_id");
  expect(service).toContain("isAuthorizedRecyclingTenant(actor.tenantId)");
  expect(service).toContain('rpc("recycling_correct_document_time"');
  expect(service).toContain("p_expected_at:expected");
  expect(service).not.toMatch(/\.(update|delete|insert)\(/);
  expect(page).toContain('createdAt={t.created_at}');
  expect(ui).not.toContain("date-correction-request");
  expect(ui).not.toContain("ส่งคำขอให้ฝ่ายบัญชี");
  expect(editor).toContain('type="datetime-local"');
  expect(editor).toContain("บันทึกการแก้ไข");
  expect(editor).toContain("result?.data?.applied!==true");
  expect(ui).toContain("VOID");
 });
 it("primes Windows only if the server returned a dedicated enrolled 5s print policy",()=>{
  const worker=read("src/components/printing/windows-native-print-agent.tsx");
  expect(worker).toContain("function primeFastPrint()");
  expect(worker).toContain('authenticatedFastIdlePollMs !== 5000');
  expect(worker).toContain('enrolledFastPrinter');
  expect(worker).toContain('window.addEventListener("cpi-windows-fast-print-prime", primeFastPrint)');
  expect(worker).toContain('window.removeEventListener("cpi-windows-fast-print-prime", primeFastPrint)');
  for(const path of [
   "src/components/pos/recycling-barcode-dialog.tsx",
   "src/components/pos/recycling-summary-print-button.tsx",
   "src/components/pos/recycling-print-receipt-button.tsx",
   "src/components/pos/recycling-shift-control.tsx"
  ]) expect(read(path)).toContain('new Event("cpi-windows-fast-print-prime")');
  expect(worker).toContain("const waitMs = urgentWakePending ? 0 : nextMs");
 });
});
