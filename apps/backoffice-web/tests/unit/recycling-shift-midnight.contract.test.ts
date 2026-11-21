import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const file=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
describe("CUSTOM Recycling shift safety contracts",()=>{
 it("does not mutate unrelated POS shifts; starts per authenticated recycling mode only",()=>{
  const open=file("src/app/api/pos/shifts/open/route.ts");
  const sql=file("../../supabase/migrations/20261121091740_custom_recycling_daily_auto_shift_20261121.sql");
  expect(open).toContain('body?.business_mode === "recycling"');
  expect(open).toContain("isAuthorizedRecyclingTenant");
  expect(open).toContain("recycling_existing_legacy_shift_requires_review");
  expect(open).toContain("recycling_shift_already_closed_today");
  expect(sql).toContain("business_shift_mode'='recycling_daily'");
  expect(sql).toContain("for update of s skip locked");
  expect(sql).toContain("recycling_mixed_legacy_shift_requires_reconciliation");
  expect(sql).toContain("cash_count_required',true");
  expect(sql).toContain("set_config('cpipos.recycling_auto_close','1',true)");
  expect(sql).not.toContain("delete from public.orders");
 });
 it("blocks opening the checkout or scanning without a valid daily shift",()=>{
  const ui=file("src/components/pos/recycling-pos-workspace.tsx");
  const service=file("src/app/api/pos/recycling/transactions/route.ts");
  expect(ui).toContain('data-testid="recycling-daily-shift-gate"');
  expect(ui).toContain('disabled={!canUseShift || posting || checkoutOpen}');
  expect(ui).toContain("recyclingBusinessDayKey(new Date())");
  expect(service).toContain("recycling_shift_daily_cutoff");
  expect(service).toContain('business_shift_mode!=="recycling_daily"');
  expect(service).toContain("requireActiveShift");
 });
 it("reuses the production shift printer with server-authoritative Recycling totals",()=>{
  const worker=file("src/lib/printing/routed-print-service.ts");
  const close=file("src/app/api/pos/shifts/close/route.ts");
  expect(worker).toContain("renderRecyclingDailyShiftCloseHtml");
  expect(worker).toContain("recyclingDailyShiftCloseText");
  expect(worker).toContain("safeReportHtml");
  expect(close).toContain('priorShiftMetadata.business_shift_mode==="recycling_daily"');
 });
});
