import type { AuthContext } from "@/lib/auth-context";
import { filterBillingDocumentItems } from "@/lib/billing-document-policy";
import { fail, ok } from "@/lib/http";
import { requirePosSession } from "@/lib/pos-session-guard";
import { queueRoutedPaymentNotice } from "@/lib/printing/routed-print-service";

type PaymentNoticePayload = {
  order_id?: string | null;
  order_no?: string | null;
  table_label?: string | null;
  total_amount?: number | null;
  discount_amount?: number | null;
  tax_amount?: number | null;
  created_at?: string | null;
  seller_name?: string | null;
  qr_data_uri?: string | null;
  account_label?: string | null;
  promptpay_label?: string | null;
  items?: Array<{ name?: string | null; quantity?: number | null; unit_price?: number | null; line_total?: number | null; note?: string | null }>;
};

function authFromScope(scope: Awaited<ReturnType<typeof requirePosSession>>): AuthContext {
  return {
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: scope.session.role === "owner" || scope.session.role === "manager" || scope.session.role === "staff" || scope.session.role === "accountant" ? scope.session.role : "staff",
    platformRole: "tenant_user"
  };
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function validQrDataUri(value: string) {
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value)) return false;
  return value.length <= 700_000;
}

export async function POST(req: Request) {
  try {
    const scope = await requirePosSession();
    const body = (await req.json()) as PaymentNoticePayload;
    const qrDataUri = clean(body.qr_data_uri);
    if (!qrDataUri || !validQrDataUri(qrDataUri)) return fail("payment_notice_qr_required", "Inline QR image is required before printing payment notice.", 422);
    const orderId = clean(body.order_id);
    const orderNo = clean(body.order_no);
    if (!orderId || !orderNo) return fail("payment_notice_order_required", "order_id and order_no are required.", 422);
    const totalAmount = Number(body.total_amount ?? 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return fail("payment_notice_amount_required", "A positive payment notice amount is required.", 422);
    const items = Array.isArray(body.items) ? body.items : [];
    const billingItems = filterBillingDocumentItems(items, { tenantCode: scope.tenant?.code, tenantMetadata: scope.tenant?.metadata }, (item) => item.unit_price);
    if (billingItems.length === 0) return fail("payment_notice_items_required", "Payment notice requires at least one payable item.", 422);

    const jobs = await queueRoutedPaymentNotice({
      auth: authFromScope(scope),
      runtimeDeviceCode: scope.session.device_code,
      order: {
        id: orderId,
        order_no: orderNo,
        table_label: clean(body.table_label),
        total_amount: totalAmount,
        discount_amount: Number(body.discount_amount ?? 0),
        tax_amount: Number(body.tax_amount ?? 0),
        created_at: clean(body.created_at) ?? new Date().toISOString()
      },
      items: billingItems.map((item) => ({
        name: clean(item.name) ?? "Item",
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unit_price ?? 0),
        lineTotal: Number(item.line_total ?? 0),
        note: clean(item.note)
      })),
      sellerName: clean(body.seller_name),
      qrDataUri,
      accountLabel: clean(body.account_label),
      promptPayLabel: clean(body.promptpay_label)
    });

    if (jobs.length === 0) return fail("payment_notice_printer_not_configured", "No routed receipt printer is configured for payment notice.", 422);
    return ok({ queued: true, print_jobs_queued: jobs.length, job_ids: jobs.map((job) => job.id) });
  } catch (error) {
    return fail("payment_notice_print_failed", error instanceof Error ? error.message : "Payment notice print failed.", 500);
  }
}
