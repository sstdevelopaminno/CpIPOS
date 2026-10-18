import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const migration=readFileSync(
  new URL("../../../../supabase/migrations/20261018100000_custom_optical_crm_it_menu_rls.sql",import.meta.url),
  "utf8"
);
describe("CUSTOM Optical CRM tenant IT switches revoke Data API access",()=>{
  it("uses a scoped, non-public security-definer helper and respects parent/child explicit denial",()=>{
    expect(migration).toContain("create or replace function app.custom_optical_crm_menu_allowed");
    expect(migration).toContain("security definer set search_path = ''");
    expect(migration).toContain("policy.tenant_id = p_tenant_id");
    expect(migration).toContain("policy.menu_key in ('main.crm_optical', p_menu_key)");
    expect(migration).toContain("policy.is_enabled = false");
    expect(migration).toContain("revoke all on function app.custom_optical_crm_menu_allowed");
    expect(migration).toContain("grant execute on function app.custom_optical_crm_menu_allowed(uuid,text)\n  to authenticated");
  });
  it("gates customer and eye exam SELECT and WRITE under existing tenant/branch roles",()=>{
    for(const name of ["optical_customers_select","optical_customers_insert","optical_customers_update",
      "optical_exams_select","optical_exams_insert"])expect(migration).toContain("create policy "+name);
    expect(migration).toContain("public.can_manage_optical_customer_data(tenant_id,branch_id)");
    expect(migration).toContain("main.crm_optical_customers");
  });
  it("keeps stock and finance read-only, independently scoped to original branch and package policies",()=>{
    for(const name of ["optical_work_orders","optical_work_order_lines","optical_stock_reservations",
      "optical_payment_ledger","optical_work_order_events"])
      expect(migration).toContain(" on public."+name+"\n  for select to authenticated");
    expect(migration).toContain("app.has_branch_access(tenant_id,branch_id)");
    expect(migration).toContain("app.custom_optical_stock_read_enabled(tenant_id)");
    expect(migration).toContain("app.custom_optical_finance_read_enabled(tenant_id)");
    expect(migration).toContain("main.crm_optical_orders");
    expect(migration).toContain("main.crm_optical_stock");
    expect(migration).not.toMatch(/(?:delete\s+from|truncate|update\s+public\.|insert\s+into\s+public\.)/i);
  });
});
