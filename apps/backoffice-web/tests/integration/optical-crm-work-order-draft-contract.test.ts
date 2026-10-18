import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const src=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261018120000_crm_optical_work_order_drafts_staged.sql"),"utf8");
describe("Staged CUSTOM Optical CRM work-order draft lifecycle",()=>{
  it("isolates draft creation from POS payment and stock until issuance",()=>{
    expect(src).toContain("public.optical_work_order_drafts");
    expect(src).toContain("status in ('draft','void','issued')");
    expect(src).toContain("create policy optical_work_order_drafts_scope_select_v1");
    expect(src).toContain("revoke all on table public.optical_work_order_drafts from public,anon,authenticated");
    expect(src).not.toMatch(/grant (?:all|insert|update|delete) on table public.optical_work_order_drafts to authenticated/);
    expect(src).toContain("public.customer_portal_save_optical_draft_v1");
    expect(src).toContain("public.customer_portal_transition_optical_draft_v1");
    expect(src).toContain("v.status<>'draft'");
    expect(src).toContain("v.version<>p_expected_version");
  });
  it("requires Owner or explicitly delegated staff edit, CUSTOM Optical and IT activation",()=>{
    expect(src).toContain("app.crm_staff_permission_allowed(");
    expect(src).toContain("'main.crm_optical_orders',true");
    expect(src).toContain("r.role::text='owner'");
    expect(src).toContain("settings.crm_optical_api_work_orders");
    expect(src).toContain("c.metadata->'custom_features'->>'optical_work_orders'='true'");
    expect(src).toContain("c.metadata->>'pos_currency_code'='LAK'");
    expect(src).toContain("auth.uid()");
  });
  it("atomic issuance calls existing stock-reserving transaction, never the deposit payment API",()=>{
    expect(src).toContain("public.optical_create_work_order_tx(");
    expect(src).toContain("v.items,v.discount_lak");
    expect(src).toContain("v.issued_order_id");
    expect(src).toContain("insert into public.optical_work_order_draft_events(");
    expect(src).not.toContain("optical_post_deposit_tx");
    expect(src).not.toContain("optical_payment_ledger");
    expect(src.match(/\bcommit\s*;/gi)).toHaveLength(1);
  });
});
