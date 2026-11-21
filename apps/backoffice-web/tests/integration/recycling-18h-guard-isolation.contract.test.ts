import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Recycling daily shift never uses ordinary POS 13:00/18:00 rollover", () => {
  const layout = file("src/app/preview/pos/layout.tsx");
  const normalGuard = file("src/components/pos/pos-shift-cycle-guard-core.tsx");
  const sales = file("src/components/pos/recycling-pos-workspace.tsx");
  const open = file("src/app/api/pos/shifts/open/route.ts");
  const join = file("src/app/api/pos/shifts/join/route.ts");
  const close = file("src/app/api/pos/shifts/close/route.ts");
  const control = file("src/components/pos/recycling-shift-control.tsx");
  const daily = file("src/lib/recycling-business-day.ts");

  it("server-selects the shift lifecycle by verified tenant entitlement", () => {
    expect(layout).toContain('isAuthorizedRecyclingTenant(scope.session.tenant_id)');
    expect(layout).toContain('!isKitchen && !isRecyclingMode ? <PosShiftCycleGuard');
    expect(normalGuard).toContain("resolveShiftCycle(openedAt)");
    expect(normalGuard).toContain('"/api/pos/shifts/close"');
    expect(normalGuard).toContain("quick_close: true");
    expect(normalGuard).toContain("clear_open_bills: clearOpenBills");
    expect(daily).toContain('RECYCLING_BUSINESS_TIME_ZONE="Asia/Bangkok"');
    expect(sales).toContain('fetch("/api/pos/recycling/shifts/current"');
  });

  it("prevents the global guard from opening or joining an ordinary POS shift for Recycling", () => {
    expect(open).toContain('const recyclingEnabled = await isAuthorizedRecyclingTenant(sessionScope.tenantId)');
    expect(open).toContain("!recyclingRequested && recyclingEnabled");
    expect(open).toContain("recycling_general_shift_disabled");
    expect(open).toContain("recycling_shift_mode_conflict");
    expect(open).toContain("async function reuseExistingShift");
    expect(open).toContain("activeMode !== \"recycling_daily\"");
    expect(join).toContain("!recyclingRequested && recyclingEnabled");
    expect(join).toContain('business_shift_mode');
    expect(join).toContain("recyclingShiftIsToday(shiftRow.opened_at)");
    expect(control).toContain('business_mode:"recycling"');
  });

  it("blocks cross-mode and cashless close even if Recycling has zero transactions", () => {
    expect(close).toContain('select("metadata,opening_cash")');
    expect(close).toContain('const recyclingShiftMode = shiftMetadata.business_shift_mode === "recycling_daily"');
    expect(close).toContain("recycling_shift_requires_explicit_close");
    expect(close).toContain("body?.shift_id !== shift.id");
    expect(close).toContain("quickClose || shouldClearOpenBills");
    expect(close).toContain("recycling_shift_mode_conflict");
    expect(close).toContain("recycling_shift_cash_count_required");
    expect(close).toContain("recyclingShiftMode && (body?.closing_cash === undefined");
    expect(close).toContain("priorShiftMetadata = shiftMetadata");
    expect(close).toContain("recyclingShiftMode");
    expect(control).toContain('shift_id:shift.id,business_mode:"recycling",closing_cash:Number(closingCash)');
    expect(control).toContain('quick_close:false');
    expect(control).toContain('setActionError(lookupFailed ? message : "")');
    expect(control).toContain("lookupFailed&&");
  });
});
