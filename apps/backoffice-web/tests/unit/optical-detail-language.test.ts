import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {opticalDetailText,opticalDetailStatus,opticalDetailDate} from "@/lib/optical-detail-i18n";
const source=(file:string)=>readFileSync(resolve(process.cwd(),"src/components/pos",file),"utf8");
describe("Optical details follow POS Thai, Lao and English settings",()=>{
 it("translates both popup headers, buttons, financial fields and exam history into Lao",()=>{
  expect(opticalDetailText("lo","รายละเอียดใบสั่งงาน")).toBe("ລາຍລະອຽດໃບສັ່ງງານ");
  expect(opticalDetailText("lo","รายละเอียดลูกค้าแว่นตา")).toBe("ລາຍລະອຽດລູກຄ້າແວ່ນຕາ");
  expect(opticalDetailText("lo","ใส่วันนัดรับ")).toBe("ໃສ່ວັນນັດຮັບ");
  expect(opticalDetailText("lo","ประวัติการรับเงิน")).toBe("ປະຫວັດການຮັບເງິນ");
  expect(opticalDetailText("lo","ประวัติตรวจสายตา")).toBe("ປະຫວັດກວດສາຍຕາ");
  expect(opticalDetailText("lo","บันทึกการแก้ไข")).toBe("ບັນທຶກການແກ້ໄຂ");
 });
 it("handles all order statuses and three languages without changing unknown status codes",()=>{
  expect(opticalDetailStatus("lo","received")).toBe("ຮັບງານແລ້ວ");
  expect(opticalDetailStatus("en","ready_for_pickup")).toBe("Ready for pickup");
  expect(opticalDetailStatus("th","collected")).toBe("ส่งมอบแล้ว");
  expect(opticalDetailStatus("lo","unknown_status")).toBe("unknown_status");
  expect(opticalDetailText("en","ยอดรวม")).toBe("Total");
  expect(opticalDetailText("th","ยอดรวม")).toBe("ยอดรวม");
 });
 it("formats an existing exam or payment date according to selected language and branch time zone",()=>{
  const iso="2026-10-20T06:50:40.000Z";
  expect(opticalDetailDate("th",iso)).toContain("2569");
  expect(opticalDetailDate("en",iso)).toContain("2026");
  expect(opticalDetailDate("lo",iso)).not.toBe(iso);
  expect(opticalDetailDate("lo","invalid")).toBe("invalid");
 });
 it("forwards the same language prop from both workspaces to their nested dialogs",()=>{
  const customer=source("pos-optical-customers-workspace.tsx");
  const order=source("pos-optical-work-orders-workspace.tsx");
  const customerDialog=source("pos-optical-customer-detail-dialog.tsx");
  const orderDialog=source("pos-optical-work-order-detail-dialog.tsx");
  expect(customer).toContain("id={selectedCustomerId} lang={lang}");
  expect(order).toContain("id={selectedOrderId} lang={lang}");
  expect(customerDialog).toContain("opticalDetailText(lang,thai)");
  expect(orderDialog).toContain("opticalDetailStatus(lang,info.order.status)");
  expect(customerDialog).toContain('aria-label={txt("รายละเอียดลูกค้าแว่นตา")}');
  expect(orderDialog).toContain('aria-label={txt("รายละเอียดใบสั่งงาน")}');
  expect(orderDialog).not.toContain('toLocaleString("th-TH")');
  expect(orderDialog).not.toContain('statusName[info.order.status]');
 });
});
