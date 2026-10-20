import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,it,expect} from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("Optical customer and work-order detail dialogs",()=>{
 it("adds POS customer details and scopes every edit/archive to tenant and branch",()=>{
  const page=src("src/components/pos/pos-optical-customers-workspace.tsx");
  const dialog=src("src/components/pos/pos-optical-customer-detail-dialog.tsx");
  const route=src("src/app/api/pos/optical/customers/manage/route.ts");
  expect(page).toContain("PosOpticalCustomerDetailDialog");
  expect(page).toContain("setSelectedCustomerId(c.id)");
  expect(dialog).toContain("ประวัติตรวจสายตา");
  expect(route).toContain('requireOpticalRetailEntitlement');
  expect(route).toContain('.eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)');
  expect(route).toContain('deleted_at:new Date().toISOString()');
  expect(route).not.toContain('.delete()');
 });
 it("shows POS work-order detail but protects financial edits and stock on cancellation",()=>{
  const page=src("src/components/pos/pos-optical-work-orders-workspace.tsx");
  const dialog=src("src/components/pos/pos-optical-work-order-detail-dialog.tsx");
  const route=src("src/app/api/pos/optical/work-orders/manage/route.ts");
  const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261020130000_optical_manage_work_order_guarded_v1.sql"),"utf8");
  expect(page).toContain("PosOpticalWorkOrderDetailDialog");
  expect(dialog).toContain("ยกเลิกใบงาน");
  expect(dialog).toContain("ใส่วันนัดรับ");
  expect(route).toContain('requireOpticalFinanceModule');
  expect(route).toContain('rpc("optical_manage_work_order_pin_v2"');
  expect(sql).toContain("optical_transition_work_order_tx");
  expect(sql).toContain("v.paid_total<>0");
  expect(sql).toContain("app.custom_optical_finance_read_enabled");
 });
});
