import { describe, expect, it } from "vitest";
import { fullySettledBillingCycleIds, unpaidBillingCycleIds, type BillingAlertCycle } from "../../src/lib/billing-alert-count";

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
  it("clears immediately when a fully verified settlement exists even before cycle status catches up", () => {
    const settled = fullySettledBillingCycleIds(sample, [{ billing_cycle_id: "due-1", amount_received: "550.00" }]);
    expect(unpaidBillingCycleIds(sample, today, settled)).toEqual([]);
  });
  it("keeps the badge after a partial settlement until the full invoice is verified", () => {
    const partial = fullySettledBillingCycleIds(sample, [{ billing_cycle_id: "due-1", amount_received: "250.00" }]);
    expect(unpaidBillingCycleIds(sample, today, partial)).toEqual(["due-1"]);
    const full = fullySettledBillingCycleIds(sample, [
      { billing_cycle_id: "due-1", amount_received: "250.00" },
      { billing_cycle_id: "due-1", amount_received: "300.00" }
    ]);
    expect(unpaidBillingCycleIds(sample, today, full)).toEqual([]);
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
