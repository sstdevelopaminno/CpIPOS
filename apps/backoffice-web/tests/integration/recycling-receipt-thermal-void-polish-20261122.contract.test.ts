import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderReceiptHtml } from "../../src/lib/printing/receipt-html-template";

const load=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const printer=load("src/lib/printing/recycling-receipt-print-service.ts");
const voidUi=load("src/components/pos/recycling-void-transaction.tsx");
const voidApi=load("src/app/api/pos/recycling/transactions/[id]/void/route.ts");
const ordinary=load("src/components/pos/pos-legacy-sales-content.tsx");

const common={
  currencyCode:"THB" as const, languageCode:"th" as const,
  storeName:"ส.เจริญทรัพย์รุ่งเรือง รีไซเคิล", branchName:"สาขาหลัก",
  storePhone:"0656459459",sellerName:"-",
  orderNo:"RCY-B-20261122-0339c99fa9bd",
  paidAtIso:"2026-11-22T04:29:00Z",
  modeLabel:"รับซื้อเข้าร้าน",
  documentHeading:"ใบเสร็จรับซื้อวัสดุรีไซเคิล",
  documentNotice:"เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี",
  items:[{name:"เหล็กแท่ง",sku:"0002555599",quantity:15,
    quantityDisplay:"15 กก.",unitPrice:3.55,unitPriceSuffix:"/กก.",lineTotal:53.25}],
  discountAmount:0,totalAmount:53.25,paymentMethod:"cash",
  paymentHeading:"จ่ายเงิน",hideCashTenderBreakdown:true,compactRecycling:true
};

describe("CUSTOM Recycling 58/80mm thermal receipt legibility",()=>{
  for(const width of [58,80] as const){
    it(`${width}mm uses a clean two-line product and full-width receipt reference`,()=>{
      const html=renderReceiptHtml({...common,paperWidthMm:width});
      expect(html).toContain(`size: ${width}mm auto`);
      expect(html).toContain('class="receipt receipt-compact"');
      expect(html).toContain('class="meta-line receipt-id-line"');
      expect(html).toContain('RCY-B-20261122-0339c99fa9bd');
      expect(html).toContain('class="recycling-item"');
      expect(html).toContain("15 กก.");
      expect(html).toContain("3.55");
      expect(html).toContain("53.25");
      expect(html).toContain("฿53.25");
      expect(html).toContain(".receipt-compact .recycling-item-detail");
      expect(html).toContain(".receipt-compact .summary-line.grand");
      expect(html).toContain("white-space:nowrap");
      expect(html).toContain("word-break:break-all");
      expect(html).toContain("ใบเสร็จรับซื้อวัสดุรีไซเคิล");
      expect(html).toContain("/brand/cpipos-logo.png");
      expect(html).not.toContain("ส่วนลด");
    });
  }
  it("does not change CSS or item layout of ordinary POS receipts",()=>{
    const html=renderReceiptHtml({...common,compactRecycling:false,paperWidthMm:58});
    expect(html).toContain('class="receipt"');
    expect(html).not.toContain('class="receipt receipt-compact"');
    expect(html).not.toContain("CUSTOM Recycling thermal-only");
    expect(html).toContain('class="col-qty"');
    expect(html).toContain("ส่วนลด");
    expect(ordinary).not.toContain("compactRecycling:true");
  });
  it("uses the same compact template for configured Print Agent and preview, without a second title",()=>{
    expect(printer).toContain('compactRecycling:true');
    expect(printer).toContain('modeLabel:isBuy ? "รับซื้อเข้าร้าน" : "ขายออก"');
    expect(printer).toContain('renderReceiptHtml({');
    expect(printer).toContain('paperWidthMm:args.width');
    expect(printer).toContain('storeAddress:storeProfile?.company_address??null');
    expect(printer).toContain('logoUrl:storeProfile?.logo_url??null');
    expect(printer).toContain('taxNotice');
  });
});

describe("Supervised VOID uses styled program confirmation instead of window.confirm",()=>{
  it("requires the final dialog confirmation before an unchanged audited VOID API request",()=>{
    expect(voidUi).not.toContain("window.confirm(");
    expect(voidUi).toContain('data-testid="recycling-void-confirm-dialog"');
    expect(voidUi).toContain('role="alertdialog" aria-modal="true"');
    expect(voidUi).toContain('data-testid="recycling-void-final-confirm"');
    expect(voidUi).toContain('setConfirmOpen(true)');
    expect(voidUi).toContain('if (!confirmOpen || saving || !enabled || bankBlocked');
    expect(voidUi).toContain('onClick={()=>void submit()}');
    expect(voidUi).toContain('if(event.key==="Escape")');
    expect(voidUi).toContain("cancelConfirmRef.current?.focus()");
  });
  it("preserves stock/cash review, bank lockout, role restrictions and retry idempotency",()=>{
    expect(voidUi).toContain('cash_returned_confirmed:cashConfirmed');
    expect(voidUi).toContain('stock_verified:true');
    expect(voidUi).toContain("voidRequestIdRef.current");
    expect(voidUi).toContain('request_id:voidRequestIdRef.current');
    expect(voidUi).toContain('reason.trim().length<10');
    expect(voidUi).toContain('setConfirmOpen(false)');
    expect(voidApi).toContain('recycling_void_self_approval_forbidden');
    expect(voidApi).toContain('recycling_void_shift_already_closed');
    expect(voidApi).toContain('recycling_void_finance_already_posted');
    expect(voidApi).toContain('RECYCLING_VOID_ENABLED');
    expect(voidUi).not.toContain('recycling_post_transaction');
  });
});
