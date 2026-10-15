import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const read=(path:string)=>readFileSync(new URL("../../src/"+path,import.meta.url),"utf8");

describe("CUSTOM Optical shift boundary and legacy isolation contract",()=>{
  it("never lets an Optical shift use restaurant auto-close deadlines",()=>{
    const guard=read("components/pos/pos-shift-cycle-guard-core.tsx");
    const session=read("app/api/pos/session/current/route.ts");
    const open=read("app/api/pos/shifts/open/route.ts");
    expect(open).toContain('business_shift_mode:"optical_daily"');
    expect(open).toContain("if(opticalShift.enabled) return NextResponse.json");
    expect(guard).toContain("resolveAuthorizedShiftCycle");
    expect(guard).toContain('slot:"daily"');
    expect(guard).toContain("if(!policy)return null");
    expect(guard).toContain("!opticalPolicy.automaticClosureReady");
    expect(session).toContain("optical_shift_policy: opticalShiftPolicy.value");
  });
  it("requires closed-loop Optical finance before activating cashless auto-close",()=>{
    const close=read("app/api/pos/shifts/close/route.ts");
    const history=read("app/api/pos/shifts/history/route.ts");
    expect(close).toContain("optical_manual_shift_close_required");
    expect(close).toContain("optical_shift_finance_reconciliation_pending");
    expect(close).toContain("getOpticalShiftUiPolicy");
    expect(history).toContain("sumVerifiedOpticalDeposits");
    expect(history).toContain("opticalPolicy.financeEnabled");
    expect(history).toContain('.eq("tenant_id",scope.session.tenant_id)');
  });
  it("does not leak sales or deposits across owner/manager and staff shift views",()=>{
    const history=read("app/api/pos/shifts/history/route.ts");
    expect(history).toContain('role === "owner" || role === "manager"');
    expect(history).toContain('if (selfOnly) shiftsQuery = shiftsQuery.eq("opened_by", scope.session.user_id)');
    expect(history).toContain("branch_filter_forbidden");
    expect(history).toContain('optical_policy: opticalPolicy');
  });
  it("renders daily labels only for IT-granted optical mode, including shift receipts",()=>{
    const ui=read("components/pos/pos-shift-history-module.tsx");
    const schedule=read("lib/pos-optical-daily-shift.ts");
    expect(ui).toContain("const opticalDaily=payload?.optical_policy?.enabled===true");
    expect(ui).toContain('isOpticalDailyRow(shift,opticalDaily) ? slotLabel("daily",lang)');
    expect(ui).toContain('shift.metadata?.business_shift_mode==="optical_daily"');
    expect(schedule).toContain("autoCloseAt:cutoffAt");
    expect(schedule).toContain("warningAt:new Date(cutoffAt.getTime()-15*60*1000)");
  });
    it("preserves normal IT package billing, tax invoices and general receipts unchanged",()=>{
    const page=read("app/preview/pos/shift/page.tsx");
    const history=read("components/pos/pos-shift-history-module.tsx");
    expect(page).toContain("PosShiftHistoryModule");
    expect(history).toContain("buildShiftHistoryCsv");
    expect(history).toContain("includeDeposit");
    expect(history).toContain("buildShiftHistoryPrintHtml");
  });
});
