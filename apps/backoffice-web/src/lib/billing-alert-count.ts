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

export type BillingAlertSettlement = {
  billing_cycle_id: string;
  amount_received: number | string | null;
};

/** Only a fully verified amount for this cycle can dismiss an unpaid badge. */
export function fullySettledBillingCycleIds(
  cycles: readonly BillingAlertCycle[],
  settlements: readonly BillingAlertSettlement[]
): ReadonlySet<string> {
  const sums = new Map<string, number>();
  for (const settlement of settlements) {
    const amount = Number(settlement.amount_received ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    sums.set(settlement.billing_cycle_id, (sums.get(settlement.billing_cycle_id) ?? 0) + amount);
  }
  return new Set(cycles
    .filter((cycle) => Number(cycle.amount_due) > 0 &&
      (sums.get(cycle.id) ?? 0) >= Number(cycle.amount_due) - 0.005)
    .map((cycle) => cycle.id));
}
