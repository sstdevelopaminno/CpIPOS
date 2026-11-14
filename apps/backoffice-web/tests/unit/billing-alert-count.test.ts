import { describe, expect, it } from "vitest";
import { unpaidBillingCycleIds, type BillingAlertCycle } from "../../src/lib/billing-alert-count";

const today = "2026-11-14";
const sample: BillingAlertCycle[] = [
  { id: "due-1", status: "overdue", period_start: "2026-11-13", amount_due: "550.00", amount_paid: "0.00" },
  { id: "paid-previous", status: "paid", period_start: "2026-10-13", amount_due: "550.00", amount_paid: "550.00" },
  { id: "paid-older", status: "paid", period_start: "2026-09-13", amount_due: "550.00", amount_paid: "550.00" }
];

describe("customer billing alert badge", () => {
  it("counts only one overdue invoice for the real Growth example structure", () => {
    expect(unpaidBillingCycleIds(sample, today)).toEqual(["due-1"]);
  });
  it("does not hide the badge after a slip is merely submitted for review", () => {
    expect(unpaidBillingCycleIds(sample, today)).toHaveLength(1);
  });
  it("clears immediately when a verified settlement exists even before cycle status catches up", () => {
    expect(unpaidBillingCycleIds(sample, today, new Set(["due-1"]))).toEqual([]);
  });
  it("clears if the cycle has become paid in the billing ledger", () => {
    const rows = sample.map((item) => item.id === "due-1" ? { ...item, status: "paid", amount_paid: "550.00" } : item);
    expect(unpaidBillingCycleIds(rows, today)).toEqual([]);
  });
  it("does not count future open invoices, cancellations or fully paid balances", () => {
    const rows: BillingAlertCycle[] = [
      { id: "future", status: "open", period_start: "2026-12-13", amount_due: 500, amount_paid: 0 },
      { id: "cancel", status: "cancelled", period_start: "2026-11-13", amount_due: 500, amount_paid: 0 },
      { id: "settled", status: "due", period_start: "2026-11-13", amount_due: 500, amount_paid: 500 },
      { id: "empty", status: "overdue", period_start: "2026-11-13", amount_due: 0, amount_paid: 0 }
    ];
    expect(unpaidBillingCycleIds(rows, today)).toEqual([]);
  });
  it("counts separate outstanding billing periods without double-counting paid periods", () => {
    const rows = [
      { id: "one", status: "due", period_start: today, amount_due: 550, amount_paid: 100 },
      { id: "two", status: "support_required", period_start: "2026-10-13", amount_due: 550, amount_paid: 0 },
      { id: "three", status: "open", period_start: today, amount_due: 550, amount_paid: 0 }
    ];
    expect(unpaidBillingCycleIds(rows, today)).toEqual(["one", "two", "three"]);
  });
});
