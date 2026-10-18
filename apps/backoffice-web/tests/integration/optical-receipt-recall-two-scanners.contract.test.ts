import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderOpticalDepositReceipt,
  renderOpticalDepositReceipt80mm
} from "../../src/lib/optical/optical-deposit-receipt-80mm";
import {buildOpticalBillRecallCode,parseOpticalBillRecallCode,type OpticalBillSnapshot} from "../../src/lib/optical/optical-deposit-contract";
const source=(path:string)=>readFileSync(resolve(process.cwd(),"src",path),"utf8");
const bill:OpticalBillSnapshot={
  tenantId:"tenant",branchId:"branch",
  orderId:"11111111-1111-4111-8111-111111111111",
  currencyCode:"LAK",totalAmount:1000000,paidAmount:400000,
  status:"partially_paid"
};
const slip={
  bill,receiptNumber:"OPT-PAYMENT-1",
  storeName:"Test CUSTOM Optical",
  branchName:"Branch A",createdAtIso:"2026-10-18T13:15:00Z",
  cashierName:"Cashier A",paymentMethod:"cash" as const,
  items:[{description:"Prescription lens",quantity:2,lineTotal:1000000}],
  qrImageDataUrl:"data:image/png;base64,aGVsbG8="
};

describe("Optical deposit receipt QR is a job locator, never another product SKU",()=>{
  it("prints the SAME signed work-order locator on both 58 and 80 mm paper",()=>{
    const code=buildOpticalBillRecallCode(bill);
    expect(code).toBe("CPI-OPTICAL-RECALL:1:"+bill.orderId);
    expect(parseOpticalBillRecallCode(code!)).toBe(bill.orderId);
    const a=renderOpticalDepositReceipt({...slip,paperWidthMm:58});
    const b=renderOpticalDepositReceipt({...slip,paperWidthMm:80});
    expect(a).toContain("@page { size: 58mm auto;");
    expect(b).toContain("@page { size: 80mm auto;");
    expect(a).toContain("width: 48mm");
    expect(b).toContain("width: 70mm");
    for(const html of [a,b]){
      expect(html).toContain(code!);
      expect(html).toContain("data:image/png;base64,aGVsbG8=");
      expect(html).toContain("ยอดค้างชำระ");
      expect(html).toContain("600,000");
      expect(html).toContain("การสแกนไม่ใช่การยืนยันการชำระเงิน");
    }
    expect(renderOpticalDepositReceipt80mm(slip)).toContain("@page { size: 80mm auto;");
  });
  it("never issues deposit QR if payment is unpaid, cancelled or already fully paid",()=>{
    expect(()=>renderOpticalDepositReceipt({...slip,bill:{...bill,paidAmount:0,status:"unpaid"},paperWidthMm:58})).toThrow("requires_committed_partial_payment");
    expect(()=>renderOpticalDepositReceipt({...slip,bill:{...bill,paidAmount:1000000,status:"paid"},paperWidthMm:80})).toThrow("requires_committed_partial_payment");
    expect(()=>renderOpticalDepositReceipt({...slip,paperWidthMm:40 as 58})).toThrow("invalid_paper");
  });
  it("accepts only an Optical receipt QR, never free-form SKU or job sheet as financial authority",()=>{
    expect(parseOpticalBillRecallCode("FRM-001")).toBeNull();
    expect(parseOpticalBillRecallCode("WO-"+bill.orderId)).toBeNull();
    expect(parseOpticalBillRecallCode("CPI-OPTICAL-RECALL:1:not-uuid")).toBeNull();
    const api=source("app/api/pos/optical/work-orders/recall/route.ts");
    expect(api).toContain("parseOpticalBillRecallCode");
    expect(api).toContain('requirePermission(scope,"sales:list:view")');
    expect(api).toContain('requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit")');
    expect(api).toContain('.eq("tenant_id",tenantId).eq("branch_id",branchId)');
    expect(api).toContain('.eq("work_order_id",id).eq("tenant_id",tenantId).eq("branch_id",branchId)');
    expect(api).toContain('response.headers.set("Cache-Control","no-store, private")');
    expect(api).toContain('remaining>0?"balance_due"');
    expect(api).toContain('data.status==="ready_for_pickup"?"pickup_ready"');
    expect(api).not.toContain("optical_post_deposit_tx");
    expect(api).not.toContain("optical_create_work_order_tx");
  });
  it("reuses dedicated bill/QR scanner, not the normal product barcode field",()=>{
    const scanner=source("components/pos/pos-general-sale-table-controller.tsx");
    const depositRoute=source("app/api/pos/optical/work-orders/[workOrderId]/deposit-receipt/route.ts");
    expect(scanner).toContain('input.setAttribute("data-pos-general-sale-sku", "1")');
    expect(scanner).toContain('billInput.setAttribute("data-pos-optical-receipt-qr", "1")');
    expect(scanner).toContain('fetch(`/api/pos/optical/work-orders/recall?code=');
    expect(scanner).toContain('method: "GET",credentials: "same-origin",cache: "no-store"');
    expect(scanner).toContain('billDetails.hidden = false;');
    expect(scanner).toContain('opticalBillRecallRequest?.abort()');
    expect(scanner).not.toContain('fetch("/api/pos/optical/work-orders",');
    expect(depositRoute).toContain('paperParam!=="58" && paperParam!=="80"');
    expect(depositRoute).toContain('renderOpticalDepositReceipt({');
    const paymentPanel=source("components/pos-ui/pos-payment-panel.tsx");
    const checkout=source("components/pos/pos-sales-module.tsx");
    expect(paymentPanel).not.toContain("onOpticalDepositReceipt");
    expect(paymentPanel).not.toContain("optical-last-deposit-receipt");
    expect(checkout).not.toContain("onOpticalDepositReceipt=");
    const printing=source("lib/printing/routed-print-service.ts");
    const deposits=source("app/api/pos/optical/deposits/route.ts");
    const existingPayments=source("app/api/pos/optical/work-orders/[workOrderId]/payments/route.ts");
    expect(printing).toContain('purpose:"receipt"');
    expect(printing).toContain("paperWidthMm:route.printer.paper_width_mm");
    expect(printing).toContain('idempotencyKey:"optical-deposit:"+args.paymentId');
    expect(printing).toContain('dedupeExisting:true');
    expect(printing).toContain('payload_format:"receipt_html_v1"');
    expect(printing).toContain('orderId:null,printerRole:"receipt"');
    expect(printing).toContain('route.printer.connection_type==="LOCAL_BRIDGE"');
    expect(printing).toContain('route.printer.connection_type==="BLUETOOTH_BRIDGE"');
    expect(printing).toContain('printer_not_qr_capable');
    expect(checkout).toContain('printStatus==="printer_not_qr_capable"');
    expect(deposits).toContain('await queueRoutedOpticalDepositReceipt(');
    expect(existingPayments).toContain('await queueRoutedOpticalDepositReceipt(');
    expect(deposits).toContain('if(result.duplicate_request!==true)');
    expect(existingPayments).toContain('if(entry.duplicate_request!==true)');
    expect(deposits).toContain('printing={status:"queue_failed",job_ids:[]};');
    expect(existingPayments).toContain('printing={status:"queue_failed",job_ids:[]};');

  });
});
