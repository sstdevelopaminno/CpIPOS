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
    expect(route).not.toContain("isAuthorizedCustomGeneralSaleTenant");
    expect(route).not.toContain('mode === "general"');
    expect(route).not.toContain("<nav");
    expect(recyclingPage).not.toContain("showGeneralShiftLink");
    expect(recyclingPage).not.toContain("ดูกะขายทั่วไป");
    expect(recyclingPage).not.toContain("/preview/pos/shift?mode=general");
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

  it("renders one edge-to-edge Recycling shift workspace without redundant header and warning strips", () => {
    const css = source("src/app/globals.css");
    expect(recyclingPage).toContain('data-testid="recycling-shift-single-container"');
    expect(recyclingPage).toContain('className="recycling-shift-layout flex h-full min-h-0 w-full flex-col');
    expect(recyclingPage).toContain("<RecyclingShiftControl");
    expect(recyclingPage).toContain("ประวัติกะ · เงินทุนหมุนเวียนรับซื้อ");
    expect(recyclingPage).not.toContain("CUSTOM · RECYCLING");
    expect(recyclingPage).not.toContain("กลับหน้ารับซื้อ–ขายออก");
    expect(recyclingPage).not.toContain("รายงานนี้แสดงยอดที่ฐานข้อมูลบันทึกเมื่อปิดกะ");
    expect(recyclingPage).not.toContain('rounded-2xl border border-slate-200 bg-white px-5');
    expect(control).toContain('className="w-full shrink-0 border-b border-slate-200 bg-white px-4 py-3"');
    expect(css).toContain(".pos-app-content-area:has(> .recycling-shift-layout)");
    expect(css).toContain("padding: 0 !important;");
    expect(css).toContain("max-width: none;");
    expect(route).toContain("<PosShiftHistoryModule lang={lang} />");
    expect(regular).toContain("export function PosShiftHistoryModule");
  });

  it("opens Recycling controls in isolated popups rather than permanent forms", () => {
    expect(control).toContain('data-testid="recycling-shift-actions"');
    expect(control).toContain('data-testid="recycling-shift-popup"');
    expect(control).toContain('role="dialog" aria-modal="true"');
    expect(control).toContain('onClick={()=>showModal("open")}');
    expect(control).toContain('onClick={()=>showModal("close")}');
    expect(control).toContain('onClick={()=>showModal("active")}');
    expect(control).toContain('form="recycling-open-shift-form"');
    expect(control).toContain('form="recycling-close-shift-form"');
    expect(control).toContain("setModalKind(null)");
    expect(control).toContain('setActionError(lookupFailed && kind!=="recover" ? message : "")');
    expect(control).toContain('setLookupErrorCode(body?.error?.code');
    expect(control).toContain('disabled={loading||busy||hasShift||closedToday!==null||lookupFailed}');
    expect(control).toContain('disabled={loading||busy||(!hasShift&&!lookupFailed)||needsJoin}');
    expect(control).not.toContain('className="mt-4 grid gap-3 lg:grid-cols-2"');
  });

  it("requires counted working capital when opening Recycling and preserves join/close guards", () => {
    expect(control).not.toContain("void autoOpen()");
    expect(control).toContain("async function openShift()");
    expect(control).toContain("async function joinShift()");
    expect(control).toContain('opening_cash:Number(openingCash)');
    expect(control).toContain('cash_count_confirmed:cashCountConfirmed');
    expect(control).toContain('!cashCountConfirmed');
    expect(control).toContain('fund_source:fundSource');
    expect(control).toContain('fetch("/api/pos/shifts/join"');
    expect(control).toContain('fetch("/api/pos/shifts/close"');
    expect(control).toContain('shift_id:shift.id,business_mode:"recycling",closing_cash:Number(closingCash)');
    expect(control).toContain('print_mode:"auto_first"');
    expect(control).toContain("กรุณานับเงินสดจริง");
    expect(control).toContain("เปิดกะรับซื้อ");
    expect(control).toContain("ปิดกะและพิมพ์สรุป");
  });
});
