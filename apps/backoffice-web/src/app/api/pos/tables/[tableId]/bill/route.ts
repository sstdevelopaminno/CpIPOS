import { resolveRestaurantQrKitchenFlags } from "@/lib/restaurant-qr-profile";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type SessionRow = {
  id: string;
  table_id: string;
  order_id: string | null;
  status: "open" | "ordering" | "pending_payment" | "closed" | "cancelled";
  opened_at: string;
  closed_at: string | null;
  metadata: Record<string, unknown>;
};

type TransferVerificationRow = {
  id: string;
  order_id: string;
  verification_status: "passed" | "failed" | "override_passed" | "error";
  expected_amount: number;
  parsed_amount: number | null;
  parsed_reference_no: string | null;
  parsed_transaction_id: string | null;
  parsed_payer_name: string | null;
  parsed_payee_name: string | null;
  expected_payee_name: string | null;
  checks: Record<string, unknown> | null;
  issues: unknown;
  error_message: string | null;
  override_approval_id: string | null;
  verified_at: string;
};

function isMissingTransferVerificationTableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("transfer_payment_verifications") &&
    (normalized.includes("could not find the table") ||
      normalized.includes("does not exist") ||
      normalized.includes("schema cache"))
  );
}

export async function GET(req: Request, context: { params: Promise<{ tableId: string }> }) {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-table-bill-ms", String(Date.now() - startedAt));
    return response;
  };
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:view" });
    await requirePosApiFeature(auth, "table_management");
    const flags = resolveRestaurantQrKitchenFlags({ tenantId: auth.tenantId, branchId: auth.branchId });
    const restaurantQrFreshTableBill = flags.qr_pos_review_required;
    const { tableId } = await context.params;
    const searchParams = new URL(req.url).searchParams;
    const liteMode = searchParams.get("lite") === "1";
    const forceRefresh = searchParams.get("refresh") === "1";
    if (!tableId) {
      return withTiming(fail("invalid_table_id", "tableId is required.", 422));
    }

    const cacheKey = `pos-table-bill:${auth.tenantId}:${auth.branchId}:${tableId}:${liteMode ? "lite" : "full"}`;
    const { value: payload, source: cacheSource } = await readThroughRuntimeCache({
      key: cacheKey,
      // Restaurant QR stays effectively live while avoiding a full Postgres fan-out on every render/poll.
      ttlMs: restaurantQrFreshTableBill ? 400 : 5000,
      staleIfErrorMs: 10000,
      forceRefresh,
      loader: async () => {
        const supabase = getSupabaseServiceClient();
        const { data: session, error: sessionError } = await supabase
          .from("table_bill_sessions")
          .select("id,table_id,order_id,status,opened_at,closed_at,metadata")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("table_id", tableId)
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle<SessionRow>();

        if (sessionError) {
          throw new Error(`session_query_failed:${sessionError.message}`);
        }

        if (!session) {
          return {
            session: null,
            order: null,
            items: [],
            payments: [],
            transfer_verifications: []
          };
        }

        if (!session.order_id) {
          return {
            session,
            order: null,
            items: [],
            payments: [],
            transfer_verifications: []
          };
        }

        const [{ data: orderRow, error: orderError }, { data: itemRows, error: itemError }, { data: paymentRows, error: paymentError }] =
          await Promise.all([
            supabase
              .from("orders")
              .select(
                "id,order_no,order_type,channel,external_order_code,table_id,customer_name,notes,subtotal,discount_amount,gp_amount,total_amount,tax_total,metadata,status,created_at"
              )
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", auth.branchId!)
              .eq("id", session.order_id)
              .maybeSingle(),
            supabase
              .from("order_items")
              .select("id,product_id,quantity,unit_price,line_total,notes,metadata,products(name)")
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", auth.branchId!)
              .eq("order_id", session.order_id)
              .order("created_at", { ascending: true }),
            liteMode
              ? Promise.resolve({ data: [], error: null })
              : supabase
                  .from("payments")
                  .select("id,method,amount,reference_no,received_at")
                  .eq("tenant_id", auth.tenantId!)
                  .eq("branch_id", auth.branchId!)
                  .eq("order_id", session.order_id)
                  .order("received_at", { ascending: false })
          ]);

        if (orderError) throw new Error(`order_query_failed:${orderError.message}`);
        if (itemError) throw new Error(`order_item_query_failed:${itemError.message}`);
        if (paymentError) throw new Error(`payment_query_failed:${paymentError.message}`);

        let transferVerifications: TransferVerificationRow[] = [];
        if (!liteMode) {
          const { data: transferVerificationRows, error: transferVerificationError } = await supabase
            .from("transfer_payment_verifications")
            .select(
              "id,order_id,verification_status,expected_amount,parsed_amount,parsed_reference_no,parsed_transaction_id,parsed_payer_name,parsed_payee_name,expected_payee_name,checks,issues,error_message,override_approval_id,verified_at"
            )
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("order_id", session.order_id)
            .order("verified_at", { ascending: false });

          if (transferVerificationError) {
            if (!isMissingTransferVerificationTableError(transferVerificationError.message)) {
              throw new Error(`transfer_verification_query_failed:${transferVerificationError.message}`);
            }
          } else {
            transferVerifications = (transferVerificationRows as TransferVerificationRow[] | null) ?? [];
          }
        }

        return {
          session,
          order: orderRow ?? null,
          items: itemRows ?? [],
          payments: paymentRows ?? [],
          transfer_verifications: transferVerifications
        };
      }
    });

    const response = ok(payload);
    response.headers.set("x-pos-table-bill-cache", cacheSource);
    return withTiming(response);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith("session_query_failed:")) {
      return withTiming(fail("session_query_failed", message.slice("session_query_failed:".length), 500));
    }
    if (message.startsWith("order_query_failed:")) {
      return withTiming(fail("order_query_failed", message.slice("order_query_failed:".length), 500));
    }
    if (message.startsWith("order_item_query_failed:")) {
      return withTiming(fail("order_item_query_failed", message.slice("order_item_query_failed:".length), 500));
    }
    if (message.startsWith("payment_query_failed:")) {
      return withTiming(fail("payment_query_failed", message.slice("payment_query_failed:".length), 500));
    }
    if (message.startsWith("transfer_verification_query_failed:")) {
      return withTiming(fail("transfer_verification_query_failed", message.slice("transfer_verification_query_failed:".length), 500));
    }
    return withTiming(fail("table_bill_query_failed", message, 400));
  }
}
