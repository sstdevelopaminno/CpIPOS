import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/lib/pos-shift-open-bills.ts"), "utf8");

describe("shift open-bill cleanup regression contract", () => {
  it("scopes active table sessions to the shift that opened them", () => {
    expect(source).toContain('.select("id,table_id,order_id,status,metadata")');
    expect(source).toContain('.contains("metadata", { opened_shift_id: args.shiftId })');
    expect(source).toContain("shift_scoped_table_sessions: true");
  });

  it("keeps order cleanup scoped by shift_id", () => {
    expect(source).toContain('.eq("shift_id", args.shiftId)');
    expect(source).toContain('.in("status", BLOCKING_ORDER_STATUSES)');
  });

  it("rechecks shift ownership before cancelling table sessions", () => {
    const updateStart = source.indexOf('.from("table_bill_sessions")\n      .update({');
    expect(updateStart).toBeGreaterThan(-1);
    const updateSection = source.slice(updateStart, updateStart + 900);
    expect(updateSection).toContain('.contains("metadata", { opened_shift_id: args.shiftId })');
    expect(updateSection).toContain('.in("id", tableSessionIds)');
  });

  it("releases only tables backed by target-shift sessions, never order table ids alone", () => {
    expect(source).toContain("shift_scoped_table_release: true");
    expect(source).toContain("blockingTableSessions.map((session) => session.table_id)");
    expect(source).not.toContain("orderTableIds");
  });
});
