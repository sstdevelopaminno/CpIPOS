import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

export type RecyclingShiftSettlement = {
  buyCount: number;
  sellCount: number;
  cashInMinor: number;
  cashOutMinor: number;
  cashNetMinor: number;
  transferInMinor: number;
  transferOutMinor: number;
  creditInMinor: number;
  creditOutMinor: number;
  expectedCashMinor: number;
};

function safeInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 9_000_000_000_000_000) {
    throw new Error("recycling_shift_invalid_" + field);
  }
  return n;
}

/**
 * Called from the existing POS shift close gate, before it marks a shift
 * closed. Zero queries for non-Recycling installations while the feature is
 * disabled. The SQL RPC is the only source of shift cash/transfer summaries.
 *
 * Never merge ordinary POS cash with recyclers in a shared shift: purchases
 * reduce drawer cash whereas normal POS payments only increase it.
 */
export async function getRecyclingShiftReconciliation(args: {
  tenantId: string;
  branchId: string;
  shiftId: string;
}): Promise<RecyclingShiftSettlement | null> {
  if (process.env.RECYCLING_STOCK_SCHEMA_READY !== "1" ||
      process.env.RECYCLING_TRANSACTION_WRITES_ENABLED !== "1") return null;
  if (!await isAuthorizedRecyclingTenant(args.tenantId)) return null;
  const db = getSupabaseServiceClient();
  const [shift, nonRecyclingOrders, totals] = await Promise.all([
    db.from("shifts").select("opening_cash")
      .eq("id",args.shiftId).eq("tenant_id",args.tenantId)
      .eq("branch_id",args.branchId).eq("status","open").maybeSingle(),
    db.from("orders").select("id").eq("tenant_id",args.tenantId)
      .eq("branch_id",args.branchId).eq("shift_id",args.shiftId).limit(1),
    db.rpc("recycling_shift_totals",{
      p_tenant_id:args.tenantId,p_branch_id:args.branchId,p_shift_id:args.shiftId
    })
  ]);
  if (shift.error || !shift.data || nonRecyclingOrders.error || totals.error || !totals.data) {
    throw new Error("recycling_shift_reconciliation_unavailable");
  }
  if ((nonRecyclingOrders.data ?? []).length > 0) {
    throw new Error("recycling_mixed_legacy_shift_requires_reconciliation");
  }
  const raw = totals.data as Record<string,unknown>;
  const cashInMinor = safeInt(raw.cash_in_minor,"cash_in");
  const cashOutMinor = safeInt(raw.cash_out_minor,"cash_out");
  const cashNetMinor = safeInt(raw.cash_net_minor,"cash_net");
  const openingCash = Number(shift.data.opening_cash ?? 0);
  if (!Number.isFinite(openingCash) || openingCash < 0 ||
      Math.abs(openingCash * 100 - Math.round(openingCash * 100)) > 0.0001) {
    throw new Error("recycling_shift_invalid_opening_cash");
  }
  const expectedCashMinor = safeInt(Math.round(openingCash*100)+cashNetMinor,"expected_cash");
  if (expectedCashMinor < 0) {
    throw new Error("recycling_shift_negative_expected_cash");
  }
  if (cashInMinor-cashOutMinor !== cashNetMinor) {
    throw new Error("recycling_shift_cash_sum_mismatch");
  }
  return {
    buyCount:safeInt(raw.buy_count,"buy_count"),
    sellCount:safeInt(raw.sell_count,"sell_count"),
    cashInMinor,cashOutMinor,cashNetMinor,
    transferInMinor:safeInt(raw.transfer_in_minor,"transfer_in"),
    transferOutMinor:safeInt(raw.transfer_out_minor,"transfer_out"),
    creditInMinor:safeInt(raw.credit_in_minor,"credit_in"),
    creditOutMinor:safeInt(raw.credit_out_minor,"credit_out"),
    expectedCashMinor
  };
}
