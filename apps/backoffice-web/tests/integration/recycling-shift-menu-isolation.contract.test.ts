import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CUSTOM Recycling shift menu isolation and cashier entry gate", () => {
  const route = source("src/app/preview/pos/shift/page.tsx");
  const regular = source("src/components/pos/pos-shift-history-module.tsx");
  const recyclingPage = source("src/components/pos/recycling-shift-history-page-content.tsx");
  const legacyRecyclingRoute = source("src/app/preview/pos/recycling/shifts/page.tsx");
  const cashier = source("src/components/pos/recycling-pos-workspace.tsx");
  const current = source("src/app/api/pos/recycling/shifts/current/route.ts");
  const control = source("src/components/pos/recycling-shift-control.tsx");

  it("preserves the original shift page for ordinary tenants", () => {
    expect(route).toContain("await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)");
    expect(route).toContain("<RecyclingShiftHistoryPageContent />");
    expect(route).toContain("<PosShiftHistoryModule lang={lang} />");
    expect(regular).toContain("export function PosShiftHistoryModule");
    expect(legacyRecyclingRoute).toContain("recycling-shift-history-page-content");
    expect(recyclingPage).toContain("<RecyclingShiftControl");
  });

  it("does not open a shift on cashier entry; only shows modal until verified", () => {
    expect(cashier).not.toContain('fetch("/api/pos/shifts/open"');
    expect(cashier).toContain('fetch("/api/pos/recycling/shifts/current"');
    expect(cashier).toContain('role="dialog" aria-modal="true"');
    expect(cashier).toContain('data-testid="recycling-daily-shift-gate"');
    expect(cashier).toContain('href="/preview/pos/shift"');
    expect(cashier).not.toContain("recycling_previous_day_shift_pending_close");
    expect(cashier).toContain('disabled={!canUseShift || posting || checkoutOpen}');
    expect(cashier).toContain('recyclingBusinessDayKey(new Date())');
  });

  it("validates entitlement, terminal, mode, business day and session binding", () => {
    expect(current).toContain('requirePermission(scope, "shift:join")');
    expect(current).toContain("isAuthorizedRecyclingTenant(scope.session.tenant_id)");
    expect(current).toContain('.eq("tenant_id", scope.session.tenant_id)');
    expect(current).toContain('.eq("branch_id", scope.session.branch_id)');
    expect(current).toContain('query.eq("device_code", scope.session.device_code)');
    expect(current).toContain('query.is("device_code", null)');
    expect(current).toContain('mode !== "recycling_daily"');
    expect(current).toContain("recyclingShiftIsToday(row.opened_at)");
    expect(current).toContain("rows.length > 1");
    expect(current).toContain("needs_join:");
    expect(current).not.toContain("shifts/open");
  });

  it("makes shift opening and joining explicit without assuming zero float", () => {
    expect(control).not.toContain("void autoOpen()");
    expect(control).toContain("async function openShift()");
    expect(control).toContain("async function joinShift()");
    expect(control).toContain('opening_cash:openingCash.trim()?Number(openingCash):null');
    expect(control).toContain('fetch("/api/pos/shifts/join"');
    expect(control).toContain('fetch("/api/pos/shifts/close"');
    expect(control).toContain('print_mode:"auto_first"');
    expect(control).toContain("กรุณานับเงินสดจริง");
    expect(control).toContain("เปิดกะวันนี้");
    expect(control).toContain("ปิดกะและพิมพ์ใบสรุป");
  });
});
