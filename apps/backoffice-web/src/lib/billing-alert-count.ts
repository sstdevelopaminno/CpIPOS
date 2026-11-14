/** Count actionable billing cycles only; a submitted slip is NOT a settled invoice. */
export type BillingAlertCycle = {
  id: string;
  status: string;
  period_start: string;
  amount_due: number | string | null;
  amount_paid: number | string | null;
};

const UNPAID_CYCLE_STATES = new Set(["open", "due", "overdue", "support_required"]);

/** Excludes future cycles, settled/void cycles, and fully paid balances. */
export function unpaidBillingCycleIds(
  cycles: readonly BillingAlertCycle[],
  bangkokToday: string,
  settledCycleIds: ReadonlySet<string> = new Set()
): string[] {
  return cycles
    .filter((cycle) =>
      UNPAID_CYCLE_STATES.has(cycle.status) &&
      cycle.period_start <= bangkokToday &&
      Number.isFinite(Number(cycle.amount_due)) &&
      Number(cycle.amount_due) > 0 &&
      Number(cycle.amount_due) - Number(cycle.amount_paid ?? 0) > 0.005 &&
      !settledCycleIds.has(cycle.id)
    )
    .map((cycle) => cycle.id);
}
