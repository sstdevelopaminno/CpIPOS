import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import {
  allowsInetNopsUatWithoutMerchantId,
  createInetNopsQrPayment,
  resolveInetNopsEnvironment,
  resolveInetNopsMerchantId
} from "@/lib/payments/inet-nops-client";
import { getDevicePolicyBlockMessage, loadPosRuntimeDevicePolicyForSession } from "@/lib/pos-device-status";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { hasBranchFeatureSafe } from "@/lib/server/feature-gate-safe";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getTenantPosCurrencyCode } from "@/lib/server/custom-pos-currency";

type Payload = {
  order_id?: string;
};

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  total_amount: number | null;
  shift_id: string | null;
};

type ProviderSettingRow = {
  id: string;
  environment: string;
  merchant_id: string | null;
  is_active: boolean;
};

type PaymentIntentRow = {
  id: string;
  provider_order_id: string;
  amount: number;
  status: "pending" | "paid" | "failed" | "expired" | "cancelled";
  qr_code: string | null;
};

function compactDate(value: Date): string {
  return value.toISOString().replace(/[-:TZ.]/g, "").slice(2, 14);
}

function buildProviderOrderId(): string {
  // INET allows at most 30 characters. Keep the order reference unguessable because it is used to match public callbacks.
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 15).toUpperCase();
  return `SST${compactDate(new Date())}${randomPart}`;
}

function describeInetCreateError(environment: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "INET QR create failed.";
  if (message.includes("html_response") || message.includes("non_json_response")) {
    return `INET ${environment.toUpperCase()} endpoint returned a non-JSON page. Please verify the INET ${environment.toUpperCase()} URLs and sandbox availability. (${message})`;
  }
  return message;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "receipts:view");
    const devicePolicy = await loadPosRuntimeDevicePolicyForSession(scope.session);
    if (devicePolicy.block_sales) {
      const response = fail(devicePolicy.reason_code ?? "pos_device_unavailable", getDevicePolicyBlockMessage(devicePolicy), 423);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }

    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    const inetNopsFeatureEnabled = await hasBranchFeatureSafe(auth.tenantId!, auth.branchId!, "inet_nops_qr");
    if (!inetNopsFeatureEnabled) {
      const response = fail("feature_not_enabled", "INET QR is not included in this branch package.", 403);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    if (await getTenantPosCurrencyCode(auth.tenantId!) === "LAK") {
      return fail("payment_provider_currency_unsupported", "INET NOPS QR accepts THB only; do not issue a QR for a LAK sale.", 422);
    }
    const body = (await request.json().catch(() => null)) as Payload | null;
    const orderId = String(body?.order_id ?? "").trim();
    if (!orderId) {
      const response = fail("missing_order_id", "order_id is required.", 422);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }

    const supabase = getSupabaseServiceClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,status,total_amount,shift_id")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", orderId)
      .maybeSingle<OrderRow>();
    if (orderError) {
      const response = fail("order_query_failed", orderError.message, 500);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    if (!order) {
      const response = fail("order_not_found", "Order not found in current branch.", 404);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    if (order.status === "completed" || order.status === "cancelled") {
      const response = fail("order_not_payable", "Order is not payable.", 409);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    const amount = Number(order.total_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0.01) {
      const response = fail("invalid_order_amount", "INET QR payment amount must be greater than 0.01 THB.", 422);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }

    const { data: shift, error: shiftError } = await supabase
      .from("shifts")
      .select("id")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", order.shift_id)
      .eq("status", "open")
      .maybeSingle<{ id: string }>();
    if (shiftError) {
      const response = fail("shift_query_failed", shiftError.message, 500);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    if (!shift) {
      const response = fail("shift_not_open", "Open shift is required before creating INET QR payment.", 409);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }

    const { data: setting, error: settingError } = await supabase
      .from("pos_payment_provider_settings")
      .select("id,environment,merchant_id,is_active")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("provider", "inet_nops")
      .eq("is_active", true)
      .maybeSingle<ProviderSettingRow>();
    if (settingError) {
      const response = fail("inet_provider_query_failed", settingError.message, 500);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    if (!setting) {
      const response = fail("inet_provider_disabled", "INET NOPS payment provider is not enabled for this branch.", 403);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }

    const { data: existingIntent, error: existingIntentError } = await supabase
      .from("pos_payment_intents")
      .select("id,provider_order_id,amount,status,qr_code")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("order_id", order.id)
      .eq("provider", "inet_nops")
      .eq("status", "pending")
      .maybeSingle<PaymentIntentRow>();
    if (existingIntentError) {
      const response = fail("payment_intent_query_failed", existingIntentError.message, 500);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    if (existingIntent?.qr_code) {
      const response = ok({
        payment_intent_id: existingIntent.id,
        provider_order_id: existingIntent.provider_order_id,
        qr_code: existingIntent.qr_code,
        amount: Number(existingIntent.amount),
        status: existingIntent.status
      });
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }

    const environment = resolveInetNopsEnvironment(setting.environment || process.env.INET_NOPS_ENV);
    const merchantId = resolveInetNopsMerchantId(environment, setting.merchant_id);
    if (!merchantId && !allowsInetNopsUatWithoutMerchantId(environment)) {
      const response = fail("inet_merchant_id_required", "INET merchant ID is required outside explicit UAT sandbox mode.", 422);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    const providerOrderId = buildProviderOrderId();
    const requestGroupId = `inet-${crypto.randomUUID()}`;
    const { data: intent, error: intentError } = await supabase
      .from("pos_payment_intents")
      .insert({
        tenant_id: auth.tenantId!,
        branch_id: auth.branchId!,
        order_id: order.id,
        provider: "inet_nops",
        provider_order_id: providerOrderId,
        merchant_id: merchantId,
        amount: Number(amount.toFixed(2)),
        currency: "THB",
        status: "pending",
        request_group_id: requestGroupId,
        created_by: auth.userId
      })
      .select("id")
      .single<{ id: string }>();
    if (intentError) {
      const response = fail("payment_intent_create_failed", intentError.message, 500);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }

    try {
      const inetResult = await createInetNopsQrPayment({
        environment,
        providerOrderId,
        orderDesc: `POS ${order.order_no}`,
        amount
      });

      const { error: updateError } = await supabase
        .from("pos_payment_intents")
        .update({
          qr_code: inetResult.qrCode,
          inet_ref1: inetResult.ref1,
          inet_ref2: inetResult.ref2,
          raw_create_response: inetResult.rawCreateResponse
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", intent.id);
      if (updateError) {
        const response = fail("payment_intent_update_failed", updateError.message, 500);
        response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
        return response;
      }

      void appendAuditLog({
        tenantId: auth.tenantId!,
        branchId: auth.branchId!,
        actorUserId: auth.userId,
        actorRole: auth.branchRole ?? auth.platformRole,
        action: "inet_payment_qr_created",
        targetTable: "pos_payment_intents",
        targetId: intent.id,
        metadata: {
          order_id: order.id,
          provider_order_id: providerOrderId,
          amount: Number(amount.toFixed(2)),
          environment
        }
      });

      const response = ok({
        payment_intent_id: intent.id,
        provider_order_id: providerOrderId,
        qr_code: inetResult.qrCode,
        amount: Number(amount.toFixed(2)),
        status: "pending"
      });
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    } catch (inetError) {
      const failedReason = describeInetCreateError(environment, inetError);
      await supabase
        .from("pos_payment_intents")
        .update({
          status: "failed",
          failed_reason: failedReason
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", intent.id);
      const response = fail("inet_qr_create_failed", failedReason, 502);
      response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
      return response;
    }
  } catch (error) {
    const response = fail("inet_qr_failed", error instanceof Error ? error.message : "Unknown error", 400);
    response.headers.set("x-pos-inet-qr-ms", String(Date.now() - startedAt));
    return response;
  }
}
