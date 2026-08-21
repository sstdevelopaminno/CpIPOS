import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/lib/pos-shift-open-bills.ts"), "utf8");

describe("shift open-bill cleanup safety contract", () => {
  it("never auto-cancels nonterminal dine-in orders", () => {
    expect(source).toContain('.eq("order_type", "dine_in")');
    expect(source).toContain("SHIFT_HAS_UNPAID_DINE_IN_ORDERS");
    expect(source).not.toContain('.from("orders")\n      .update({');
    expect(source).toContain("unpaid_dine_in_orders_cancelled: false");
  });

  it("scopes table cleanup to the shift that opened the session", () => {
    expect(source).toContain('.select("id,table_id,order_id,status,metadata")');
    expect(source).toContain('.contains("metadata", { opened_shift_id: args.shiftId })');
    expect(source).toContain("shift_scoped_table_sessions: true");
    expect(source).toContain("shift_scoped_table_release: true");
  });

  it("refuses to clear a linked active table bill", () => {
    expect(source).toContain("SHIFT_HAS_ACTIVE_TABLE_BILLS");
    expect(source).toContain("blockingTableSessions.filter((session) => Boolean(session.order_id))");
  });

  it("cancels and releases only empty target-shift table sessions", () => {
    expect(source).toContain("emptyTableSessions");
    expect(source).toContain('.is("order_id", null)');
    expect(source).toContain("only_empty_table_sessions_released: true");
  });
});
