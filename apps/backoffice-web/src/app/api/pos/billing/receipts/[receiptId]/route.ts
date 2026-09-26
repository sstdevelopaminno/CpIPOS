import { fail } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { renderSubscriptionReceiptHtml } from "@/lib/printing/subscription-receipt-html-template";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ receiptId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReceiptRow = {
  id: string;
  tenant_id: string;
  receipt_number: string;
  issued_at: string;
  amount: number;
  currency: string;
  issuer_snapshot: Record<string, unknown>;
  customer_snapshot: Record<string, unknown>;
  package_snapshot: Record<string, unknown>;
  payment_snapshot: Record<string, unknown>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const scope = await requirePosSession();
    if (!["owner","manager"].includes(scope.session.role)) {
      return fail("forbidden", "Store owner or manager access required.", 403);
    }
    const { receiptId } = await params;
    if (!UUID.test(receiptId)) return fail("receipt_invalid", "Invalid receipt identifier.", 422);

    const db = getPrimarySupabaseServiceClient();
    const result = await db.from("tenant_subscription_receipts")
      .select("id,tenant_id,receipt_number,issued_at,amount,currency,issuer_snapshot,customer_snapshot,package_snapshot,payment_snapshot")
      .eq("id", receiptId)
      .eq("tenant_id", scope.session.tenant_id)
      .maybeSingle<ReceiptRow>();

    if (result.error) {
      console.error("[pos-subscription] receipt read failed", result.error.message);
      return fail("receipt_unavailable", "Unable to load receipt.", 503);
    }
    if (!result.data) return fail("receipt_not_found", "Receipt not found.", 404);

    const receipt = result.data;
    const html = renderSubscriptionReceiptHtml({
      receiptNumber: receipt.receipt_number,
      issuedAt: receipt.issued_at,
      amount: Number(receipt.amount),
      currency: receipt.currency || "THB",
      issuer: receipt.issuer_snapshot ?? {},
      customer: receipt.customer_snapshot ?? {},
      packageSnapshot: receipt.package_snapshot ?? {},
      paymentSnapshot: receipt.payment_snapshot ?? {}
    });

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${receipt.receipt_number}.html"`,
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-subscription] receipt route failed", error);
    return fail("receipt_unavailable", "Unable to load receipt.", 503);
  }
}
