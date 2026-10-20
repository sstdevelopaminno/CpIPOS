import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
describe("Optical work order UI uses existing printer settings",()=>{
 it("keeps PIN outside main view and opens a date-specific popup",()=>{
  const dialog=src("src/components/pos/pos-optical-work-order-detail-dialog.tsx");
  expect(dialog).toContain("ใส่วันนัดรับ");
  expect(dialog).toContain('aria-label={action==="date"?"ใส่วันนัดรับ":"ยกเลิกใบงาน"}');
  expect(dialog).toContain('type="date"');
  expect(dialog).toContain('type="password"');
  expect(dialog).toContain('manager_pin:managerPin');
  expect(dialog).toContain('rounded-xl border border-slate-200');
  expect(dialog).not.toContain("ขนาดใบสั่งงาน/ใบเสร็จ");
  expect(dialog).not.toContain('option value={58}');
  expect(dialog).not.toContain('option value={80}');
 });
 it("selects an enabled receipt printer from the existing branch registry and queues its print job",()=>{
  const handler=src("src/app/api/pos/optical/work-orders/[workOrderId]/print/route.ts");
  expect(handler).toContain('resolvePrinterRoutes({auth,purpose:"work_order",fallbackPurposes:["receipt"],legacyRole:"receipt"})');
  expect(handler).toContain("route.printer.paper_width_mm");
  expect(handler).toContain("routing_printer_device_id");
  expect(handler).toContain("payload_html:html");
  expect(handler).toContain('printerRole:"receipt"');
  expect(handler).toContain("enqueuePrintJob");
  expect(handler).toContain('orderId:null');
  expect(handler).toContain('loadReceipt(new Request(url.toString())');
  expect(handler).not.toContain("printReceiptAutomatically");
  const cashier=src("src/components/pos/pos-sales-module.tsx");
  const pickup=src("src/components/pos/pos-optical-pickup-balance-dialog.tsx");
  expect(cashier).toContain("requestOpticalWorkOrderPrint(workOrderId)");
  expect(pickup).toContain("requestOpticalWorkOrderPrint(orderId)");
  expect(pickup).not.toContain("setReceiptWidth");

 });
 it("prints employee display name from saved identity rather than payment received_by UUID",()=>{
  const route=src("src/app/api/pos/optical/work-orders/[workOrderId]/deposit-receipt/route.ts");
  expect(route).toContain('from("users_profiles")');
  expect(route).toContain('select("full_name")');
  expect(route).toContain('cashierName,');
  expect(route).not.toContain('cashierName:payment.received_by');
  const html=src("src/lib/optical/optical-deposit-receipt-80mm.ts");
  expect(html).toContain('input.cashierName');
  expect(html).toContain('class="barcode"');
 });
});
