import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("CUSTOM Recycling legacy 18:00 shift recovery isolation",()=>{
  const db=src("../../supabase/migrations/20261121130000_recycling_legacy_shift_manager_recovery.sql");
  const status=src("src/app/api/pos/recycling/shifts/current/route.ts");
  const recovery=src("src/app/api/pos/recycling/shifts/recover/route.ts");
  const ui=src("src/components/pos/recycling-shift-control.tsx");
  const original=src("src/components/pos/pos-shift-history-module.tsx");
  const layout=src("src/app/preview/pos/layout.tsx");
  const regular=src("src/app/api/pos/shifts/open/route.ts");

  it("keeps the normal POS UI and 13:00/18:00 guard unchanged for other packages",()=>{
    expect(layout).toContain("!isKitchen && !isRecyclingMode ? <PosShiftCycleGuard");
    expect(original).toContain("export function PosShiftHistoryModule");
    expect(regular).toContain("recycling_general_shift_disabled");
    expect(recovery).not.toContain('from("orders").delete()');
    expect(recovery).not.toContain('from("shifts").update(');
    expect(status).toContain("recovery_allowed:");
  });

  it("requires explicit role, counted zero cash, and manager confirmation",()=>{
    expect(ui).toContain('data-testid="recycling-recover-legacy-button"');
    expect(ui).toContain('modalKind==="recover"');
    expect(ui).toContain('recoveryCash.trim()!=="0.00"');
    expect(ui).toContain('recoveryPhrase.trim()!=="ยืนยันกู้คืนกะ"');
    expect(ui).toContain('confirmation:"ยืนยันกู้คืนกะ"');
    expect(recovery).toContain('requirePermission(scope,"shift:open")');
    expect(recovery).toContain('requirePermission(scope,"shift:close")');
    expect(recovery).toContain('["owner","manager"].includes(scope.session.role)');
    expect(recovery).toContain('typeof body.counted_cash!=="number" || body.counted_cash!==0');
    expect(recovery).toContain("isAuthorizedRecyclingTenant(scope.session.tenant_id)");
    expect(recovery).toContain('db.rpc("recycling_recover_legacy_shift_v1"');
    expect(recovery).toContain("updateCachedPosSessionShift(scope.session.id,shiftId)");
  });

  it("refuses nonzero activity, unrelated shifts, cross-branch and reused sessions in the DB transaction",()=>{
    expect(db).toContain("create or replace function public.recycling_recover_legacy_shift_v1(");
    expect(db).toContain("security definer");
    expect(db).toContain("set search_path = ''");
    expect(db).toContain("v_session.role not in ('owner','manager')");
    expect(db).toContain("v_session.status<>'active'");
    expect(db).toContain("v_legacy.opening_cash is distinct from 0::numeric");
    expect(db).toContain("s.device_code is not distinct from v_session.device_code");
    expect(db).toContain("v_recycling.opening_cash is not null");
    expect(db).toContain("v_recycling.closing_cash is not null");
    expect(db).toContain("v_recycling.actual_cash is distinct from 0::numeric");
    expect(db).toContain("'recycling_auto_on_cashier_entry'");
    expect(db).toContain("'pos_session_gate'");
    expect(db).toContain("from public.orders o");
    expect(db).toContain("from public.payments p");
    expect(db).toContain("from public.recycling_transactions t");
    expect(db).toContain("from public.cash_drawer_events e");
    expect(db).toContain("from public.table_bill_sessions b");
    expect(db).toContain("'recycling_recovery_concurrent_close'");
    expect(db).toContain("revoke all on function public.recycling_recover_legacy_shift_v1");
    expect(db).toContain("to service_role;");
  });

  it("preserves historical Recycling shift and writes a mandatory atomic audit",()=>{
    expect(db).toContain("'recovery_from_closed_recycling_shift_id',v_recycling.id");
    expect(db).toContain("insert into public.shifts(");
    expect(db).toContain("'recycling_legacy_shift_manager_recovery'");
    expect(db).toContain("status='closed',closed_by=v_session.user_id");
    expect(db).toContain("insert into public.audit_logs(");
    expect(db).toContain("zero_transactions_verified',true");
    expect(db).toContain("update public.pos_sessions set shift_id=v_new_shift");
    expect(db).not.toContain("delete from public.orders");
    expect(db).not.toContain("delete from public.recycling_transactions");
    expect(db).not.toContain("update public.shifts set status='open' where id=v_recycling.id");
  });
});
