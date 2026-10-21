import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const view=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261021180000_optical_manager_pin_bcrypt_compat.sql"),"utf8");
describe("CUSTOM Optical manager PIN, due date, protected catalog",()=>{
 it("validates bcrypt variant in scoped owner or manager without weakening access or changing existing PIN",()=>{
  expect(sql).toContain("optical_manage_work_order_pin_v2");
  expect(sql).toContain("left(u.pin_hash,4) in ('$2b$','$2y$')");
  expect(sql).toContain("'$2a$'||substring(u.pin_hash from 5)");
  expect(sql).toContain("r.tenant_id=p_tenant_id and r.branch_id=p_branch_id");
  expect(sql).toContain("r.role::text in ('owner','manager')");
  expect(sql).toContain("OPTICAL_MANAGER_PIN_INVALID");
  expect(sql).toContain("optical_transition_work_order_tx");
  expect(sql).toContain("OPTICAL_REFUND_REQUIRED_BEFORE_CANCELLATION");
  expect(sql).not.toContain("update public.users_profiles");
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.optical_manage_work_order_pin_v2");
 });
 it("uses the same PIN for due-date update and cancellation, but does not silently delete collected payments",()=>{
  const client=view("components/pos/pos-optical-work-order-detail-dialog.tsx");
  const api=view("app/api/pos/optical/work-orders/manage/route.ts");
  expect(client).toContain('id,action:action==="date"?"update":"cancel"');
  expect(client).toContain('manager_pin:managerPin');
  expect(client).toContain('due+"T12:00:00+07:00"');
  expect(client).toContain("workOrderActionError");
  expect(client).toContain("OPTICAL_MANAGER_PIN_INVALID");
  expect(client).toContain("OPTICAL_REFUND_REQUIRED_BEFORE_CANCELLATION");
  expect(client).not.toContain('{paid===0?<button');
  expect(api).toContain('rpc("optical_manage_work_order_pin_v2"');
  expect(api).toContain('p_branch_id:scope.session.branch_id');
 });
 it("lets a manager archive or restore linked Optical SKUs without deleting stock or active reservations",()=>{
  const ui=view("components/pos/optical-stock-workspace.tsx");
  const page=view("app/preview/pos/stock/custom/page.tsx");
  const api=view("app/api/pos/optical/catalog/route.ts");
  expect(ui).toContain('changeSaleVisibility(row,row.is_active?"archive":"restore")');
  expect(ui).toContain('show_inactive=1');
  expect(ui).toContain('T("ลบ")');
  expect(page).toContain("showInactive");
  expect(page).toContain("is_active");
  expect(api).toContain('export async function PUT(request:Request)');
  expect(api).toContain('role!=="owner"&&role!=="manager"');
  expect(api).toContain('optical_catalog_sale_archived');
  expect(api).toContain('optical_catalog_sale_restored');
  expect(api).toContain('optical_catalog_in_use');
  expect(api).toContain('is_active:!archived');
  expect(api).not.toContain('.from("optical_stock_bins").delete(');
 });
});
