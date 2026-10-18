import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261018113000_crm_optical_owner_staff_permissions_staged.sql"),"utf8");
describe("Staged Optical CRM staff permissions: IT eligibility and Owner authority",()=>{
  it("adds only authenticated, tenant/branch-scoped optical staff read policies",()=>{
    expect(sql).toContain("create table if not exists public.tenant_crm_employee_permissions");
    expect(sql).toContain("primary key (tenant_id,branch_id,user_id,menu_key)");
    expect(sql).toContain("alter table public.tenant_crm_employee_permissions enable row level security");
    expect(sql).toContain("revoke all on public.tenant_crm_employee_permissions from public, anon, authenticated");
    expect(sql).toContain("create policy optical_customers_crm_staff_read_v1");
    expect(sql).toContain("create policy optical_eye_exams_crm_staff_read_v1");
    expect(sql).toContain("create policy optical_work_orders_crm_staff_read_v1");
    expect(sql).toContain("create policy optical_work_order_lines_crm_staff_read_v1");
    expect(sql).not.toMatch(/create policy optical_\w+_crm_staff_(?:insert|update|delete)/i);
  });
  it("never allows staff in solely because IT opened the Staff access switch",()=>{
    expect(sql).toContain("menu_key='settings.crm_access_staff'");
    expect(sql).toContain("perm.can_view");
    expect(sql).toContain("perm.menu_key in ('main.crm_optical_customers','main.crm_optical_orders')");
    expect(sql).toContain("g.user_id=auth.uid()");
    expect(sql).toContain("g.can_view=true");
    expect(sql).toContain("and c.metadata->'sales_modes'->>'optical_retail'='true'");
    expect(sql).toContain("raise exception 'crm_staff_access_disabled'");
  });
  it("lets only an authenticated tenant Owner grant or revoke employee rights",()=>{
    expect(sql).toContain("public.customer_portal_set_staff_crm_permission_v1");
    expect(sql).toContain("r.role::text='owner'");
    expect(sql).toContain("r.role::text='staff'");
    expect(sql).toContain("insert into public.tenant_crm_permission_events");
    expect(sql).toContain("revoke all on function public.customer_portal_set_staff_crm_permission_v1");
    expect(sql).toContain("grant execute on function public.customer_portal_set_staff_crm_permission_v1");
  });
  it("never offers a staff session full CRM features or unchecked payment data",()=>{
    expect(sql).toContain("public.customer_portal_staff_feature_state_v1");
    for(const key of ["main.crm_staff","main.crm_package","main.crm_more","main.crm_settings","main.crm_optical_reports"])
      expect(sql).toContain("'"+key+"',false");
    expect(sql).not.toContain("optical_payment_ledger_crm_staff_read_v1");
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+public\.optical_/i);
    expect(sql.match(/\bcommit\s*;/gi)).toHaveLength(1);
  });
});
