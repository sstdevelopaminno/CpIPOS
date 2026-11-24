import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("Recycling closed-today shift state",()=>{
  const current=src("src/app/api/pos/recycling/shifts/current/route.ts");
  const open=src("src/app/api/pos/shifts/open/route.ts");
  const control=src("src/components/pos/recycling-shift-control.tsx");

  it("returns a read-only closed-today marker scoped to this tenant, branch and terminal",()=>{
    expect(current).toContain('if (!row) {');
    expect(current).toContain('recyclingBusinessDayKey(new Date())');
    expect(current).toContain('startOfOpticalLocalDateUtc(today, "Asia/Bangkok")');
    expect(current).toContain('.eq("tenant_id",scope.session.tenant_id)');
    expect(current).toContain('.eq("branch_id",scope.session.branch_id)');
    expect(current).toContain('.eq("status","closed")');
    expect(current).toContain('.contains("metadata",{business_shift_mode:"recycling_daily"})');
    expect(current).toContain('closedQuery.eq("device_code",scope.session.device_code)');
    expect(current).toContain('closedQuery.is("device_code",null)');
    expect(current).toContain('closed_today: closedToday');
    expect(current).toContain('recycling_shift_daily_review_failed');
    expect(current).not.toContain('.from("shifts").insert(');
    expect(current).not.toContain('.from("shifts").update(');
  });

  it("keeps the server-side same-day financial restriction authoritative",()=>{
    expect(open).toContain('recycling_shift_already_closed_today');
    expect(open).toContain('.contains("metadata",{business_shift_mode:"recycling_daily"})');
    expect(open).toContain('if (sessionScope.deviceCode) sameDay=sameDay.eq("device_code",sessionScope.deviceCode)');
  });

  it("prevents a misleading new-shift form and reloads authoritative state after conflict",()=>{
    expect(control).toContain('setClosedToday(activeToday ? null : body?.data?.closed_today ?? null)');
    expect(control).toContain('closedToday?"ปิดกะแล้ววันนี้":"ยังไม่เปิดกะ"');
    expect(control).toContain('disabled={loading||busy||hasShift||closedToday!==null||lookupFailed}');
    expect(control).toContain('modalKind==="open"&&!lookupFailed&&!closedToday');
    expect(control).toContain('response.status===409 && body?.error?.code==="recycling_shift_already_closed_today"');
    expect(control).toContain('setClosedToday({id:shift.id,opened_at:shift.opened_at,closed_at:null})');
  });
});
