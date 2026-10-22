import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";

const app=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261021090000_optical_daily_shift_auto_close_worker.sql"),"utf8");
describe("Optical CUSTOM midnight auto-close",()=>{
 it("runs on the database scheduler, not a cashier browser timer",()=>{
  expect(sql).toContain("cron.schedule('cpipos-optical-daily-auto-close-v2'");
  expect(sql).toContain("'* * * * *'");
  expect(sql).toContain("for update of s skip locked");
  expect(sql).toContain("on conflict(shift_id) do nothing");
  expect(sql).toContain("where s.id=v.id and s.tenant_id=v.tenant_id");
  expect(app("components/pos/pos-shift-cycle-guard-core.tsx")).toContain("if(opticalPolicy?.enabled)return;");
 });
 it("isolates IT-opted-in Lao Optical CUSTOM tenants, never food",()=>{
  for(const part of ["lower(pkg.code)='custom'","'optical_daily'","'Asia/Vientiane'","'LAK'",
  "c.metadata->'sales_modes'->>'optical_retail'='true'",
  "c.metadata->'custom_features'->>'optical_daily_auto_close'='true'",
  "c.metadata->'custom_features'->>'optical_work_orders'='true'"])
    expect(sql).toContain(part);
  const policy=app("lib/server/optical-shift-ui-policy.ts");
  expect(policy).toContain('features.optical_daily_auto_close===true');
  expect(policy).toContain('currency==="LAK"');
 });
 it("never guesses counted cash or silently discards deposits and incomplete payments",()=>{
  expect(sql).toContain("cash_count_required boolean not null default true");
  expect(sql).toContain("v_expected:=round(v.opening_cash+v_legacy_cash+v_optical_cash,2)");
  expect(sql).toContain("l.cumulative_paid<w.total_amount");
  expect(sql).toContain("expected_cash=null,actual_cash=null,closing_cash=null");
  expect(sql).toContain("business_day_cutoff_at");
  expect(sql).toContain("l.received_at>=v_cutoff");
  expect(sql).toContain("l.currency_code<>'LAK'");
  expect(sql).toContain("b.status in ('open','ordering','pending_payment')");
  expect(sql).toContain("update public.pos_sessions s set shift_id=null");
 });
 it("permits validated manual Optical close while preserving shift metadata and ledger",()=>{
  const close=app("app/api/pos/shifts/close/route.ts");
  expect(close).not.toContain('code:"optical_shift_finance_reconciliation_pending"');
  expect(close).toContain('optical_shift_ledger_needs_review');
  expect(close).toContain("opticalExpectedCash");
  expect(close).toContain("opticalCashReceived");
  expect(close).toContain("priorShiftMetadata");
  expect(close).toContain('opticalPolicy.enabled ? opticalExpectedCash');
  expect(app("components/pos/pos-shift-cycle-guard-core.tsx")).toContain('!closingCash.trim()');
 });
});