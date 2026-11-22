import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
import { renderReceiptHtml } from "../../src/lib/printing/receipt-html-template";

const read=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const cashier=read("src/components/pos/recycling-pos-workspace.tsx");
const dialog=read("src/components/pos/recycling-receipt-dialog.tsx");
const preview=read("src/app/api/pos/recycling/receipts/[id]/preview/route.ts");
const autoPrint=read("src/lib/printing/recycling-receipt-print-service.ts");
const printRoute=read("src/app/api/pos/recycling/receipts/[id]/print/route.ts");
const actions=read("src/components/pos/recycling-sales-list-row-actions.tsx");
const list=read("src/components/pos/recycling-sales-list-page-content.tsx");
const receiptPage=read("src/app/preview/pos/recycling/receipts/[id]/page.tsx");
const voidRoute=read("src/app/api/pos/recycling/transactions/[id]/void/route.ts");
const voidComponent=read("src/components/pos/recycling-void-transaction.tsx");
const ordinary=read("src/components/pos/pos-legacy-sales-content.tsx");

describe("CUSTOM Recycling receipt after atomic purchase/sale",()=>{
  it("opens an in-place modal only after the transaction POST confirms the committed transaction ID",()=>{
    expect(cashier).toContain('if (!response.ok || !body?.data?.transaction?.id)');
    expect(cashier).toContain('const committedId = body.data.transaction.id');
    expect(cashier).toContain("setPosted({");
    expect(cashier).toContain("setReceiptDialogOpen(true)");
    expect(cashier).toContain("await queueReceiptPrint(committedId, currentRequestId)");
    expect(cashier).toContain('receiptNo={posted.receipt_no} open={receiptDialogOpen}');
    expect(cashier).toContain('onClick={()=>setReceiptDialogOpen(true)}');
    expect(cashier).toContain('requestIdRef.current = ""');
    expect(dialog).toContain('data-testid="recycling-receipt-modal"');
    expect(dialog).toContain('onClose={');
    expect(ordinary).not.toContain("RecyclingReceiptDialog");
  });
  it("uses existing profile logo/address, device routing 58/80 and fallbacks when no printer",()=>{
    expect(preview).toContain('loadReceiptStoreProfile(tenantId)');
    expect(preview).toContain('resolvePrinterRoutes(');
    expect(preview).toContain('runtimeDeviceCode:deviceCode');
    expect(preview).toContain('if(routes[0]?.printer.paper_width_mm===58)width=58');
    expect(preview).toContain('if(paper==="58")width=58');
    expect(preview).toContain('renderRecyclingSharedReceipt({');
    expect(preview).toContain('logoUrl:profile?.logo_url??null');
    expect(preview).toContain('storeAddress:profile?.company_address??null');
    expect(autoPrint).toContain('renderReceiptHtml(');
    expect(autoPrint).toContain('storeAddress:storeProfile?.company_address??null');
    expect(autoPrint).toContain('logoUrl:storeProfile?.logo_url??null');
    expect(printRoute).toContain('queueRoutedRecyclingReceipt({');
    const receipt=renderReceiptHtml({
      paperWidthMm:58,storeName:"ร้านตัวอย่าง",branchName:"สาขาหลัก",
      storeAddress:"ซอย 1",storePhone:"12345",sellerName:"ผู้ขาย",
      orderNo:"RCY-B-TEST",paidAtIso:"2026-11-22T04:00:00Z",
      items:[{name:"เหล็กแท่ง",quantity:15,unitPrice:3.55,lineTotal:53.25,
        quantityDisplay:"15 กก.",unitPriceSuffix:"/กก."}],
      discountAmount:0,totalAmount:53.25,paymentMethod:"cash",
      hideCashTenderBreakdown:true,documentHeading:"ใบเสร็จรับซื้อวัสดุรีไซเคิล",
      documentNotice:"เอกสารการซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี"
    });
    expect(receipt).toContain("58mm");
    expect(receipt).toContain("/brand/cpipos-logo.png");
    expect(receipt).toContain("ซอย 1");
    expect(receipt).toContain("53.25");
    expect(receipt).toContain("ไม่ใช่ใบกำกับภาษี");
    expect(receipt).not.toContain("VAT 7%");
  });
  it("supports A5 printing on A4/A5 Windows device without silently claiming a print-job succeeded",()=>{
    expect(preview).toContain('["auto","58","80","a5"]');
    expect(preview).toContain('@page { size: A5 portrait; margin: 10mm; }');
    expect(preview).toContain('paper==="a5"');
    expect(dialog).toContain('data-testid="recycling-print-a5"');
    expect(dialog).toContain('contentWindow.print()');
    expect(dialog).toContain("showBrowserButton={false}");
    expect(dialog).toContain("เครื่องพิมพ์ A4/A5");
    expect(dialog).toContain("หน้าต่างพิมพ์ของ Windows/เบราว์เซอร์");
    expect(dialog).not.toContain("recycling_post_transaction");
  });
  it("requires authenticated same-branch receipt scope and checks stored line totals",()=>{
    expect(preview).toContain('await requirePosSession()');
    expect(preview).toContain('requirePermission(scope,"shift:join")');
    expect(preview).toContain('isAuthorizedRecyclingTenant(scope.session.tenant_id)');
    expect(preview).toContain('.eq("tenant_id",tenantId).eq("branch_id",branchId)');
    expect(preview).toContain('lines.data.reduce((sum,l)=>sum+Number(l.amount_minor),0)!==storedTotal');
    expect(preview).toContain('"Cache-Control":"private, no-store, max-age=0"');
    expect(preview).not.toContain('.insert(');
    expect(preview).not.toContain('.update(');
    expect(preview).not.toContain('.delete(');
  });
});

describe("CUSTOM Recycling invoice corrections / VOID through sales-list modal",()=>{
  it("moves correction and VOID out of the standalone receipt into modal actions",()=>{
    expect(list).toContain('<RecyclingSalesListRowActions');
    expect(actions).toContain('data-testid="recycling-sales-list-row-actions"');
    expect(actions).toContain('แก้ไขบิล');
    expect(actions).toContain('ยกเลิก (VOID)');
    expect(actions).toContain('data-testid="recycling-document-action-modal"');
    expect(actions).toContain('data-testid="recycling-safe-bill-correction"');
    expect(actions).toContain('<RecyclingVoidTransaction');
    expect(actions).toContain('startExpanded={true}');
    expect(actions).toContain('<RecyclingReceiptDialog');
    expect(receiptPage).not.toContain("<RecyclingVoidTransaction");
    expect(actions).not.toContain('window.location.href');
  });
  it("does not directly edit posted prices/weights/stock without audited reversal",()=>{
    expect(actions).toContain("ไม่อนุญาตให้แก้ยอดเงิน น้ำหนัก ราคาหรือคู่ค้าในเอกสารเดิมโดยตรง");
    expect(actions).toContain("ยกเลิกต้นฉบับตามสิทธิ์ แล้วจึงสร้างบิลใหม่");
    expect(actions).not.toContain("/api/pos/recycling/transactions/"+'"+receiptId+"/edit');
    expect(actions).not.toContain(".update(");
    expect(voidRoute).toContain('process.env.RECYCLING_VOID_ENABLED!=="1"');
    expect(voidRoute).toContain('recycling_void_self_approval_forbidden');
    expect(voidRoute).toContain('recycling_void_shift_already_closed');
    expect(voidRoute).toContain('recycling_void_finance_already_posted');
    expect(voidComponent).toContain('startExpanded=false');
    expect(voidComponent).toContain('window.confirm(');
  });
});
