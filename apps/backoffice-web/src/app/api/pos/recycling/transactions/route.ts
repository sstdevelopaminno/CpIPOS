import { fail, ok } from "@/lib/http";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { PosGuardError, requireActiveShift, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

type TransactionPayload = {
  request_id?: unknown;
  direction?: unknown;
  settlement?: unknown;
  counterparty_name?: unknown;
  lines?: unknown;
};

type TxLine = {
  product_id: string;
  unit: string;
  quantity: number;
  expected_price: number;
};

const VALID_UNITS = new Set(["kg", "khid", "g", "ton", "piece"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

function readLine(value: unknown): TxLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const line = value as Record<string, unknown>;
  if (typeof line.product_id !== "string" || !UUID.test(line.product_id) ||
      typeof line.unit !== "string" || !VALID_UNITS.has(line.unit)) return null;
  const qty = Number(line.quantity);
  const price = Number(line.expected_price);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 100000000 ||
      !Number.isFinite(price) || price < 0 || price > 99999999 ||
      !MONEY_PATTERN.test(String(price))) return null;
  // Limit precision to six decimal places. One gram equals 0.001 kg.
  if (!/^\d{1,10}(\.\d{1,6})?$/.test(String(qty))) return null;
  if (line.unit === "piece" && !Number.isInteger(qty)) return null;
  return { product_id: line.product_id, unit: line.unit, quantity: qty, expected_price: price };
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
    if (!await isAuthorizedRecyclingTenant(scope.session.tenant_id)) {
      return fail("recycling_not_authorized", "This tenant does not have the active CUSTOM Recycling entitlement.", 403);
    }
    const { shift } = await requireActiveShift(scope);
    const raw = await request.json().catch(() => null) as TransactionPayload | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
        typeof raw.request_id !== "string" || !UUID.test(raw.request_id) ||
        !["buy", "sell"].includes(String(raw.direction)) ||
        !["cash", "bank_transfer", "credit"].includes(String(raw.settlement))) {
      return fail("invalid_recycling_transaction", "Invalid transaction request.", 422);
    }
    const counterparty = typeof raw.counterparty_name === "string" ? raw.counterparty_name.trim() : "";
    if (!counterparty || counterparty.length > 240) {
      return fail("counterparty_required", "Please enter the customer/supplier name.", 422);
    }
    if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 100) {
      return fail("invalid_recycling_lines", "Cart must contain 1–100 line items.", 422);
    }
    const lines = raw.lines.map(readLine);
    if (lines.some((line) => line === null)) {
      return fail("invalid_recycling_line", "Invalid barcode, quantity, unit or expected price.", 422);
    }
    const db = getSupabaseServiceClient();
    // Atomic RPC is the ONLY path for posting a purchase/sale. It prices from
    // the server-side catalog, locks stock, records documents and balances its
    // accounting subledger in the same Postgres transaction.
    const { data, error } = await db.rpc("recycling_post_transaction", {
      p_tenant_id: scope.session.tenant_id,
      p_branch_id: scope.session.branch_id,
      p_shift_id: shift.id,
      p_user_id: scope.session.user_id,
      p_request_id: raw.request_id,
      p_direction: raw.direction,
      p_settlement: raw.settlement,
      p_counterparty_name: counterparty,
      p_lines: lines
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        return fail("recycling_migration_required", "Recycling transaction backend is not installed. No transaction was recorded.", 503);
      }
      const safeCodes = ["recycling_stock_insufficient","recycling_price_changed_refresh_cart",
        "recycling_price_missing","recycling_shift_closed","recycling_contract_not_authorized",
        "recycling_subscription_inactive","recycling_line_amount_too_small",
        "recycling_unit_mismatch","recycling_product_not_found","recycling_counterparty_required"];
      const matched = safeCodes.find(code => error.message.includes(code));
      if (matched) return fail(matched, matched, 409);
      console.error("[recycling-post] transaction rejected", { code: error.code });
      return fail("recycling_post_failed", "Purchase/sale was not recorded; please verify and retry.", 500);
    }
    return ok({ transaction: data });
  } catch (error) {
    if (error instanceof PosGuardError || error instanceof FeatureGateError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("recycling_post_failed", "Unable to record the transaction.", 500);
  }
}
