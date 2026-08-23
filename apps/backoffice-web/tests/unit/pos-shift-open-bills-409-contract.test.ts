import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("POS shift open-bill blocker responses", () => {
  it("returns HTTP 409 with structured unpaid dine-in blockers before shift close", () => {
    const route = source("src/app/api/pos/shifts/close/route.ts");
    expect(route).toContain("getShiftOpenBillBlockers");
    expect(route).toContain('if (openBills.count > 0)');
    expect(route).toContain('return openBillsBlockedResponse({ count: openBills.count, blockers: openBills.blockers, source: "shift_close_precheck" });');
    expect(route).toContain('code: "shift_has_open_bills"');
    expect(route).toContain("blockers: args.blockers");
    expect(route).toContain("{ status: 409 }");
  });

  it("continues into the existing close path when no unpaid dine-in bill blocks the shift", () => {
    const route = source("src/app/api/pos/shifts/close/route.ts");
    const blockerCheck = route.indexOf('if (openBills.count > 0)');
    const shiftUpdate = route.indexOf('status: "closed"', blockerCheck);
    expect(blockerCheck).toBeGreaterThan(0);
    expect(shiftUpdate).toBeGreaterThan(blockerCheck);
    expect(route).toContain('[pos-shifts-close] close_completed');
  });

  it("maps clear-open-bills genuine unpaid blockers to 409 instead of 500", () => {
    const route = source("src/app/api/pos/shifts/clear-open-bills/route.ts");
    expect(route).toContain("ShiftOpenBillsBlockedError");
    expect(route).toContain("openBillsBlockedResponse(error)");
    expect(route).toContain('code: "shift_has_open_bills"');
    expect(route).toContain("blockers: error.blockers");
    expect(route).toContain("{ status: 409 }");
  });

  it("keeps clearShiftOpenBills fail-closed and exposes exact blocker fields", () => {
    const helper = source("src/lib/pos-shift-open-bills.ts");
    expect(helper).toContain("class ShiftOpenBillsBlockedError");
    expect(helper).toContain("SHIFT_HAS_UNPAID_DINE_IN_ORDERS");
    expect(helper).toContain("order_id: order.id");
    expect(helper).toContain("order_no: order.order_no");
    expect(helper).toContain("table_id: order.table_id");
    expect(helper).toContain("table_code:");
    expect(helper).toContain("status: order.status");
    expect(helper).toContain("total: getOrderTotal(order)");
    expect(helper).toContain("unpaid_dine_in_orders_cancelled: false");
  });

  it("shows owner and manager the exact bill/table/status/total from API blockers", () => {
    const guard = source("src/components/pos/pos-shift-cycle-guard-core.tsx");
    const history = source("src/components/pos/pos-shift-history-module.tsx");
    for (const uiSource of [guard, history]) {
      expect(uiSource).toContain("formatOpenBillBlockers");
      expect(uiSource).toContain("error?.blockers");
      expect(uiSource).toContain("order_no ?? blocker.order_id");
      expect(uiSource).toContain("table_code ?? blocker.table_id");
      expect(uiSource).toContain("Open bill blocking shift close");
    }
  });
});