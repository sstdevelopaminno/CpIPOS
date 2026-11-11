import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PosSalesSummaryPayload } from "@/lib/services/pos-sales-summary-service";
import { renderSalesPrintHtml } from "@/lib/printing/sales-summary-report-html";

const sample: PosSalesSummaryPayload = {
  currencyCode:"THB",
  currencyBuckets:[{currencyCode:"THB",receiptCount:2,netSales:155},{currencyCode:"LAK",receiptCount:1,netSales:50000}],
  access:{canViewMultipleBranches:false,selfOnly:false,selectedBranchId:"branch-1"},
  filters:{dateFrom:"2026-11-01",dateTo:"2026-11-30",branchId:"branch-1",shiftId:"all",cashierId:"all",paymentMethod:"all",status:"all"},
  branchOptions:[{id:"branch-1",code:"001",name:"ร้าน <script>alert(1)</script>"}],
  shiftOptions:[],cashierOptions:[],
  summary:{grossSales:160,netSales:155,receiptCount:2,cashTotal:50,qrTransferTotal:105,cardTotal:0,discountTotal:5,taxTotal:0,refundTotal:0,cancelledTotal:0,cancelledCount:0,averageReceiptValue:77.5},
  paymentMethods:[{method:"cash",label:"เงินสด",amount:50,receiptCount:1},{method:"bank_transfer",label:"โอน / QR",amount:105,receiptCount:1}],
  bestSellingProducts:[{productId:"product-1",productName:"ข้าวมันไก่ <b>3</b>",category:"อาหาร",quantitySold:2,grossAmount:100,netAmount:100}],
  cashiers:[{cashierId:"user-1",cashierName:"พนักงาน 1",receiptCount:2,grossSales:160,netSales:155,cancelledTotal:0,cancelledCount:0,averageReceiptValue:77.5}],
  shifts:[{id:"shift-1",branchId:"branch-1",branchName:"สาขา 1",openedAt:"2026-11-11T09:00:00Z",closedAt:"2026-11-11T10:00:00Z",cashierName:"พนักงาน 1",openingCash:200,cashSales:50,expectedCash:250,actualCash:250,difference:0,receiptCount:2,netSales:155}],
  salesRows:[{id:"order-1",receiptNo:"DIN-001",branchId:"branch-1",branchName:"สาขา 1",shiftId:"shift-1",createdAt:"2026-11-11T09:00:00Z",cashierName:"พนักงาน 1",paymentMethod:"cash",paymentLabel:"เงินสด",grossTotal:100,discount:0,tax:0,netTotal:100,status:"completed",currencyCode:"THB"}]
};
const render=(kind:"summary"|"payments"|"products"|"cashiers"|"sales"|"sale_row"|"shift_row",paperWidthMm:58|80=80,rowId?:string)=>
  renderSalesPrintHtml({payload:sample,kind,paperWidthMm,language:"th",rowId}).html;

describe("Sales summary thermal report printing",()=>{
  it("shows correct paper vs XP-80T safe printable widths without clipping amounts",()=>{
    const html80=render("summary",80);
    expect(html80).toContain("@page{size:80mm auto;margin:0}");
    expect(html80).toContain("main.receipt{width:56mm;margin:0 0 0 1mm");
    expect(html80).toContain("฿155.00");
    expect(html80).toContain("ไม่ใช่ใบเสร็จรับเงิน");
    const html58=render("summary",58);
    expect(html58).toContain("@page{size:58mm auto;margin:0}");
    expect(html58).toContain("main.receipt{width:42mm;margin:0 0 0 1mm");
  });
  it("escapes server-sourced names and never sums unrelated currencies",()=>{
    const html=render("payments");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("LAK (1 bills)");
    expect(html).toContain("฿155.00");
  });
  it("renders all three details plus authorized sale and shift rows",()=>{
    expect(render("products")).toContain("สินค้าขายดี");
    expect(render("products")).toContain("&lt;b&gt;3&lt;/b&gt;");
    expect(render("cashiers")).toContain("พนักงาน 1");
    expect(render("payments")).toContain("โอน / QR");
    expect(render("sale_row",80,"order-1")).toContain("DIN-001");
    expect(render("shift_row",80,"shift-1")).toContain("เงินคาดหวัง");
    expect(()=>render("sale_row",80,"not-authorized")).toThrow("sales_print_row_not_in_authorized_scope");
  });
  it("never silently truncates too many detailed sales records",()=>{
    const crowded={...sample,salesRows:Array.from({length:121},(_,i)=>({...sample.salesRows[0],id:"order-"+i}))};
    expect(()=>renderSalesPrintHtml({payload:crowded,kind:"sales",paperWidthMm:80,language:"th"}))
      .toThrow("sales_print_too_many_rows_narrow_period");
  });
  it("requires a print preview and manual confirmation, and routes Windows vs Android separately",()=>{
    const ui=readFileSync("src/components/pos-preview/sales-summary-print-dialog.tsx","utf8");
    const api=readFileSync("src/app/api/pos/sales-summary/print/route.ts","utf8");
    const service=readFileSync("src/lib/services/pos-sales-summary-service.ts","utf8");
    expect(ui).toContain('if(!html||!previewHash||preparedSignature!==signature||busy||attempted)return;');
    expect(ui).toContain("printWindowsReceiptHtml(html,{reprint:true})");
    expect(ui).toContain('mode:"queue"');
    expect(api).toContain('requiredPermission:"reports:view"');
    expect(api).toContain("fullYearReport:true");
    expect(api).toContain("sales_print_preview_stale");
    expect(api).toContain('createHash("sha256")');
    expect(api).not.toContain("input.report_html");
    expect(service).toContain('throw new Error("sales_report_too_many_orders_narrow_period")');
  });
});
