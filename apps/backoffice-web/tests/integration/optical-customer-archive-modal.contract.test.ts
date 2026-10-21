import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";

const source=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const dialog=source("components/pos/pos-optical-customer-detail-dialog.tsx");
const route=source("app/api/pos/optical/customers/manage/route.ts");
const translation=source("lib/optical-detail-i18n.ts");

describe("CUSTOM Optical customer archive confirmation modal",()=>{
 it("uses an accessible themed confirmation instead of a native browser prompt",()=>{
  expect(dialog).not.toContain("window.confirm(");
  expect(dialog).toContain('role="alertdialog"');
  expect(dialog).toContain('aria-modal="true"');
  expect(dialog).toContain('aria-labelledby="optical-archive-title"');
  expect(dialog).toContain('aria-describedby="optical-archive-description"');
  expect(dialog).toContain('rounded-2xl border border-slate-200 bg-white');
  expect(dialog).toContain('grid grid-cols-2 gap-3 border-t');
  expect(dialog).toContain('ref={archiveCancel}');
  expect(dialog).toContain('event.key==="Escape"');
  expect(dialog).toContain('event.key==="Tab"');
 });
 it("requires explicit confirmation and disables a second archive while the request is pending",()=>{
  expect(dialog).toContain("setArchiveConfirm(true)");
  expect(dialog).toContain("if(!data||busy||!archiveConfirm||!data.canArchive)return");
  expect(dialog).toContain("onClick={()=>void archive()}");
  expect(dialog).toContain("disabled={busy}");
  expect(dialog).toContain("setArchiveError");
  expect(dialog).toContain('role="alert"');
  expect(dialog).toContain('method:"DELETE"');
  expect(dialog).toContain('onChanged();onClose()');
  expect(dialog).not.toContain('method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,action:"archive"');
 });
 it("preserves the existing manager/owner permissions, history and linked-order guard",()=>{
  expect(dialog).toContain("data.canArchive?");
  expect(route).toContain('["owner","manager"].includes(String(scope.session.role))');
  expect(route).toContain('.neq("status","cancelled")');
  expect(route).toContain("deleted_at:new Date().toISOString()");
  expect(route).toContain('action:"optical_customer_archived"');
  expect(route).not.toContain('.delete()');
 });
 it("shows accurate customer-specific warnings in Thai, English and Lao without promising a restore feature",()=>{
  for(const label of ["ยืนยันการเก็บประวัติลูกค้า","ข้อมูลจะไม่ถูกลบถาวร","ยืนยันเก็บถาวร","กำลังเก็บถาวร..."])
    expect(translation).toContain(label);
  expect(translation).toContain('"en": "Archive this customer?"');
  expect(translation).toContain('"lo": "ຢືນຢັນການເກັບປະຫວັດລູກຄ້າ"');
  expect(dialog).toContain("data.customer.full_name");
  expect(dialog).toContain("data.customer.customer_code");
  expect(dialog).not.toContain("กู้คืน");
 });
});
