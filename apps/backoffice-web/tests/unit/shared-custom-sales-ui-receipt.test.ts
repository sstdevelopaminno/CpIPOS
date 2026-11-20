import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderReceiptHtml } from "@/lib/printing/receipt-html-template";

const src = (path: string) => readFileSync(resolve(process.cwd(),path),"utf8");

describe("shared sales UI standard / CUSTOM / Recycling",()=>{
 const standard=src("src/components/pos/pos-sales-module.tsx");
 const recycler=src("src/components/pos/recycling-sales-mode-switcher.tsx");
 const workspace=src("src/components/pos/recycling-pos-workspace.tsx");
 const sharedMeta=src("src/components/pos/pos-sales-meta-details.tsx");
 const recyclerContent=src("src/components/pos/recycling-sales-content.tsx");
 const recyclerPrint=src("src/lib/printing/recycling-receipt-print-service.ts");

 it("renders exactly the same header metadata component and POS grid for all modes",()=>{
   expect(standard).toContain("<PosSalesMetaDetails");
   expect(recycler).toContain("<PosSalesMetaDetails");
   expect(sharedMeta).toContain('className="posui-sales-meta-columns"');
   expect(sharedMeta).toContain("<PosRealtimeClock");
   expect(sharedMeta).toContain("shiftStatus");
   expect(recyclerContent).toContain('eq("device_code",deviceCode)');
   expect(recyclerContent).toContain('eq("id",operatorUserId)');
   expect(recycler).toContain('className="posui-mode-header-row"');
   expect(recycler).toContain('className="posui-topbar-collapse-toggle"');
 });
 it("does not mix buying with generic POS order pricing",()=>{
   expect(workspace).toContain('direction === "buy" ? pending.buyPrice : pending.sellPrice');
   expect(workspace).toContain("<table");
   expect(workspace).toContain("recycling-barcode");
   expect(workspace).toContain('fetch("/api/pos/recycling/transactions"');
 });
 it("shares the exact receipt template with normal POS and only changes labels/units",()=>{
   expect(recyclerPrint).toContain('import { renderReceiptHtml }');
   expect(recyclerPrint).toContain('renderReceiptHtml({');
   expect(recyclerPrint).toContain("quantityDisplay:");
   expect(recyclerPrint).toContain("voidWarning:");
 });

 it("labels Recycling credit buying/selling as outstanding rather than paid",()=>{
   expect(recyclerPrint).toContain('const isCredit = args.settlement === "credit"');
   expect(recyclerPrint).toContain('"ยอดค้างจ่ายผู้ขาย"');
   expect(recyclerPrint).toContain('"ยอดค้างรับจากผู้ซื้อ"');
   expect(recyclerPrint).toContain("ยังไม่มีการรับหรือจ่ายเงินจริง");
   for (const width of [58, 80] as const) {
     const html = renderReceiptHtml({
       storeName:"ร้านทดสอบ", sellerName:"คู่ค้าทดสอบ", orderNo:"CR-001",
       paidAtIso:"2026-11-20T04:00:00Z", paperWidthMm:width,
       items:[{name:"เหล็ก", quantity:2, unitPrice:10, lineTotal:20}],
       discountAmount:0, totalAmount:20, paymentMethod:"credit",
       paymentHeading:"ยอดค้างจ่ายผู้ขาย",
       footerText:"เครดิต/ค้างชำระ — ยังไม่มีการรับหรือจ่ายเงินจริง"
     });
     expect(html).toContain("ยอดค้างจ่ายผู้ขาย");
     expect(html).toContain("เครดิต/ค้างชำระ");
     expect(html).toContain("ยังไม่มีการรับหรือจ่ายเงินจริง");
     expect(html).not.toContain("รับชำระเงิน");
   }
 });
});

describe("optional CUSTOM receipt fields don't change the standard 58/80mm template",()=>{
 const base={
   storeName:"ร้านทดสอบ",
   branchName:"สาขาหลัก",
   sellerName:"พนักงาน",
   orderNo:"B-001",
   paidAtIso:"2026-11-20T04:00:00Z",
   items:[{name:"สินค้าทดสอบ",quantity:1,unitPrice:45,lineTotal:45}],
   discountAmount:0,
   totalAmount:45,
   paymentMethod:"cash"
 } as const;
 it.each([58,80] as const)("retains standard paper, money, and footer on %imm",width=>{
   const html=renderReceiptHtml({...base,paperWidthMm:width,items:[...base.items]});
   expect(html).toContain(`@page { size: ${width}mm auto; margin: 0; }`);
   expect(html).toContain('class="summary-line grand"');
   expect(html).toContain("ขอบคุณที่ใช้บริการ");
   expect(html).not.toContain("เอกสารยกเลิก VOID");
 });
 it("renders CUSTOM weighed items, payment label and explicit void safely",()=>{
   const html=renderReceiptHtml({
     ...base,paperWidthMm:80,
     items:[{name:"เหล็ก",sku:"FE-01",quantity:1.255,quantityDisplay:"1,255 กรัม",
       unitPrice:12.5,unitPriceSuffix:"/กก.",lineTotal:15.69}],
     totalAmount:15.69,
     sellerLabel:"ผู้ขายวัสดุ",
     sellerName:"ลูกค้าทดสอบ",
     modeLabel:"หลักฐานรับซื้อวัสดุรีไซเคิล",
     paymentHeading:"จ่ายเงินผู้ขาย",
     documentNotice:"ไม่ใช่ใบกำกับภาษี",
     voidWarning:"ยกเลิก VOID <ข้อความ>",
     footerText:"น้ำหนักตามเครื่องชั่งภายนอก"
   });
   expect(html).toContain("1,255 กรัม");
   expect(html).toContain("FE-01");
   expect(html).toContain("จ่ายเงินผู้ขาย");
   expect(html).toContain("หลักฐานรับซื้อวัสดุรีไซเคิล");
   expect(html).toContain("&lt;ข้อความ&gt;");
   expect(html).not.toContain("VOID <ข้อความ>");
   expect(html).toContain("น้ำหนักตามเครื่องชั่งภายนอก");
 });
});
