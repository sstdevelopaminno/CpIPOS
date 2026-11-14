import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSessionForNonSaleRecovery } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { fullySettledBillingCycleIds, unpaidBillingCycleIds, type BillingAlertCycle, type BillingAlertSettlement } from "@/lib/billing-alert-count";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scope = await requirePosSessionForNonSaleRecovery();
    if (scope.session.role !== "owner" && scope.session.role !== "manager") {
      return fail("forbidden", "Owner or manager access required.", 403);
    }

    // Billing uses Bangkok calendar days; do not count an open future cycle.
    const bangkokToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const db = getSupabaseServiceClient();
    const { data: cycles, error: cycleError } = await db
      .from("tenant_billing_cycles")
      .select("id,status,period_start,amount_due,amount_paid")
      .eq("tenant_id", scope.session.tenant_id)
      .in("status", ["open", "due", "overdue", "support_required"])
      .lte("period_start", bangkokToday)
      .order("period_start", { ascending: false })
      .limit(500);
    if (cycleError) throw cycleError;

    const candidateIds = unpaidBillingCycleIds((cycles ?? []) as BillingAlertCycle[], bangkokToday);
    let count = candidateIds.length;
    if (candidateIds.length) {
      // A bank-confirmed settlement must clear the badge even before
      // asynchronous billing-cycle status reconciliation completes.
      const { data: settlements, error: settlementError } = await db
        .from("tenant_subscription_settlements")
        .select("billing_cycle_id,amount_received")
        .eq("tenant_id", scope.session.tenant_id)
        .in("billing_cycle_id", candidateIds);
      if (settlementError) throw settlementError;
      const settled = fullySettledBillingCycleIds(
        (cycles ?? []) as BillingAlertCycle[],
        (settlements ?? []) as BillingAlertSettlement[]
      );
      count = unpaidBillingCycleIds((cycles ?? []) as BillingAlertCycle[], bangkokToday, settled).length;
    }

    const response = ok({ unpaid_count: count });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-billing-alert] unable to count outstanding invoices", error);
    return fail("billing_alert_unavailable", "Unable to check outstanding invoices.", 503);
  }
}
