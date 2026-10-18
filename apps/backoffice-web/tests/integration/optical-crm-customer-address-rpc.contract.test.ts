import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync(new URL("../../../../supabase/migrations/20261018110000_custom_optical_customer_address_v1.sql",import.meta.url),"utf8");

describe("CUSTOM Optical CRM customer address migration",()=>{
 it("is additive, preserves eye examinations and uses a private audited address history",()=>{
  expect(sql).toContain("add column if not exists address text");
  expect(sql).toContain("create table if not exists public.optical_customer_address_events");
  expect(sql).toContain("unique(tenant_id,branch_id,request_id)");
  expect(sql).toContain("alter table public.optical_customer_address_events enable row level security");
  expect(sql).toContain("revoke all on table public.optical_customer_address_events from public, anon, authenticated");
  expect(sql).toContain("grant select on public.optical_customer_address_events to authenticated");
  expect(sql).not.toContain("truncate");
  expect(sql).not.toContain("delete from public.optical_eye_exams");
 });
 it("rejects branch hopping, unauthorized access and retry conflicts",()=>{
  expect(sql).toContain("create or replace function public.optical_save_customer_address_v1");
  expect(sql).toContain("v_actor := auth.uid()");
  expect(sql).toContain("public.can_manage_optical_customer_data(p_tenant_id,p_branch_id)");
  expect(sql).toContain("app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers')");
  expect(sql).toContain("c.tenant_id=p_tenant_id");
  expect(sql).toContain("c.branch_id=p_branch_id");
  expect(sql).toContain("for update");
  expect(sql).toContain("OPTICAL_ADDRESS_IDEMPOTENCY_CONFLICT");
  expect(sql).toContain("raise exception 'OPTICAL_ADDRESS_ACCESS_DENIED'");
  expect(sql).toContain("grant execute on function public.optical_save_customer_address_v1");
 });
 it("has a single transaction and function definition",()=>{
  expect((sql.match(/^begin;$/gm)||[]).length).toBe(1);
  expect((sql.match(/^commit;$/gm)||[]).length).toBe(1);
  expect(sql.split("$function$").length-1).toBe(2);
 });
});
