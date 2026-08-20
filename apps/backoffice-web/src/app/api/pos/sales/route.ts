import type { OrderType } from "@pos/shared-types";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { hasBranchFeatureSafe } from "@/lib/server/feature-gate-safe";
import { getDevicePolicyBlockMessage, loadPosRuntimeDevicePolicyForSession, type PosRuntimeDevicePolicy } from "@/lib/pos-device-status";
import { PosGuardError, requirePermission, requirePosSession, type PosSessionScope } from "@/lib/pos-session-guard";
import {
  calculateDeliveryPricingBreakdown,
  DEFAULT_DELIVERY_CHANNEL_CONFIGS,
  parseDeliveryChannel,
  validateExternalOrderCode
} from "@/lib/delivery-pricing";
import { fail, ok } from "@/lib/http";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { POS_GUARDS } from "@/lib/pos-resilience";
import { invalidatePosSalesListCacheForScope } from "@/lib/services/pos-sales-list-service";
import { queueMissingKitchenPrintJobsForOrder } from "@/lib/services/kitchen-routing-service";
import { executeCreatePosOrderTransaction } from "@/lib/services/pos-sales-service";
import { calculateTaxBreakdown, loadPosNotificationSettings, loadTaxSettings } from "@/lib/services/pos-settings-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type PosCreateOrderPayload = {
  order_id?: string;
  shift_id: string;
  order_type: OrderType;
  channel: string;
  table_id?: string | null;
  external_order_code?: string | null;
  customer_name?: string | null;
  member_name?: string | null;
  member_phone?: string | null;
  member_code?: string | null;
  member_points?: number | null;
  member_stamps?: number | null;
  notes?: string | null;
  app_total_amount: number;
  discount_amount?: number;
  gp_amount?: number;
  tax_total?: number;
  grand_total?: number;
  tax_lines?: ReturnType<typeof calculateTaxBreakdown>["lines"];
  delivery_pricing_channel?: string | null;
  delivery_app_subtotal?: number | null;
  delivery_commission_rate_pct?: number | null;
  delivery_commission_amount?: number | null;
  delivery_commission_vat_rate_pct?: number | null;
  delivery_commission_vat_amount?: number | null;
  delivery_platform_fee_amount?: number | null;
  delivery_net_payout_amount?: number | null;
  delivery_pricing_source_url?: string | null;
  delivery_pricing_note?: string | null;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price?: number | null;
    notes?: string | null;
  }>;
};

type ResolvedOrderItem = {
  product_id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
};

type DeliveryConfigRow = {
  channel: string;
  commission_rate_pct: number;
  commission_vat_rate_pct: number;
  order_code_rule: "free_text" | "regex";
  order_code_regex: string | null;
  source_url: string | null;
};

type PaymentAccountRow = {
  id: string;
  branch_id: string;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  promptpay_phone: string | null;
  promptpay_payload: string | null;
  qr_image_url: string | null;
  qr_mode: string | null;
  applies_to_all_branches: boolean | null;
  is_active: boolean | null;
};

type PaymentProviderSettingRow = {
  provider: "promptpay_manual" | "inet_nops";
  environment: "uat" | "production";
  merchant_id: string | null;
  is_active: boolean | null;
};

type PosSalesAuthContext = Awaited<ReturnType<typeof getPosApiAuthContext>>;

function normalizePosBranchRole(role: string): PosSalesAuthContext["branchRole"] {
  if (role === "owner" || role === "manager" || role === "staff" || role === "accountant") return role;
  return "staff";
}

function authFromPosScope(scope: PosSessionScope): PosSalesAuthContext {
  return {
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: normalizePosBranchRole(scope.session.role),
    platformRole: "tenant_user"
  };
}

async function queueKitchenPrintRecoveryForPosOrder(args: { auth: PosSalesAuthContext; orderId: string; runtimeDeviceCode?: string | null }) {
  if (!args.orderId) return;
  try {
    await queueMissingKitchenPrintJobsForOrder({
      auth: args.auth,
      orderId: args.orderId,
      runtimeDeviceCode: args.runtimeDeviceCode ?? null
    });
  } catch (error) {
    console.warn("[pos-sales] kitchen print recovery failed", {
      orderId: args.orderId,
      message: error instanceof Error ? error.message : "kitchen_print_recovery_failed"
    });
  }
}

async function requireSalesSessionContext(permission: "sales:enter"): Promise<{
  auth: PosSalesAuthContext;
  devicePolicy: PosRuntimeDevicePolicy;
  scope: PosSessionScope;
}> {
  const scope = await requirePosSession();
  requirePermission(scope, permission);
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  return {
    auth: authFromPosScope(scope),
    devicePolicy: await loadPosRuntimeDevicePolicyForSession(scope.session),
    scope
  };
}

function failFromSalesError(error: unknown, fallbackCode: string, fallbackStatus: number) {
  if (error instanceof FeatureGateError) {
    return fail(error.code, error.message, error.status);
  }
  if (error instanceof PosGuardError) {
    return fail(error.code, error.message, error.status);
  }
  return fail(fallbackCode, error instanceof Error ? error.message : "Unknown error", fallbackStatus);
}

type PosProductQueryRow = {
  id: string;
  sku?: string | null;
  name?: string | null;
  category?: string | null;
  price?: number | null;
  is_active?: boolean | null;
  stock_deduction_mode?: "unit_only" | "recipe_deduction" | null;
  has_recipe_deduction?: boolean;
};

type RecipeStockRow = {
  product_id: string;
  quantity_per_item: number | null;
  ingredients:
    | { quantity_on_hand: number | null }
    | Array<{ quantity_on_hand: number | null }>
    | null;
};

type RecipeProductRow = {
  product_id: string;
  ingredients:
    | { name: string | null }
    | Array<{ name: string | null }>
    | null;
};

type ResolvedOrderPricingResult =
  | {
      ok: true;
      data: {
        items: ResolvedOrderItem[];
        subtotal: number;
        discountAmount: number;
        gpAmount: number;
        totalAmount: number;
        taxTotal: number;
        grandTotal: number;
        taxLines: ReturnType<typeof calculateTaxBreakdown>["lines"];
        delivery_pricing_channel: string | null;
        delivery_app_subtotal: number | null;
        delivery_commission_rate_pct: number | null;
        delivery_commission_amount: number | null;
        delivery_commission_vat_rate_pct: number | null;
        delivery_commission_vat_amount: number | null;
        delivery_platform_fee_amount: number | null;
        delivery_net_payout_amount: number | null;
        delivery_pricing_source_url: string | null;
        delivery_pricing_note: string | null;
      };
    }
  | { ok: false; code: string; status: number; message: string };

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function isMissingDeliveryPricingSchemaError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  return text.includes("delivery_channel_configs") || text.includes("product_channel_prices");
}

function isMissingPaymentAccountSchemaError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") return true;
  return text.includes("tenant_payment_accounts") || text.includes("qr_mode") || text.includes("applies_to_all_branches");
}

function isMissingPaymentProviderSchemaError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  return text.includes("pos_payment_provider_settings");
}

function mapPaymentAccount(row: PaymentAccountRow | null | undefined) {
  if (!row) return null;
  const promptpayPhone = String(row.promptpay_phone ?? "").trim();
  return {
    id: row.id,
    branch_id: row.branch_id,
    bank_name: String(row.bank_name ?? "").trim(),
    account_name: String(row.account_name ?? "").trim(),
    account_number: String(row.account_number ?? "").trim(),
    promptpay_phone: promptpayPhone,
    promptpay_payload: String(row.promptpay_payload ?? "").trim(),
    qr_image_url: String(row.qr_image_url ?? "").trim(),
    qr_mode: row.qr_mode === "qr_image" ? "qr_image" : "promptpay_link",
    applies_to_all_branches: Boolean(row.applies_to_all_branches),
    is_active: row.is_active !== false
  };
}

const ORDER_DELIVERY_SNAPSHOT_COLUMNS = [
  "delivery_pricing_channel",
  "delivery_app_subtotal",
  "delivery_commission_rate_pct",
  "delivery_commission_amount",
  "delivery_commission_vat_rate_pct",
  "delivery_commission_vat_amount",
  "delivery_platform_fee_amount",
  "delivery_net_payout_amount",
  "delivery_pricing_source_url",
  "delivery_pricing_note"
] as const;

function isMissingOrderDeliverySnapshotColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error?.message) return false;
  const message = String(error.message).toLowerCase();
  return ORDER_DELIVERY_SNAPSHOT_COLUMNS.some((column) => message.includes(`'${column}'`) || message.includes(`"${column}"`) || message.includes(`${column}`));
}

function isMissingProductSkuColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42703") return true;
  return text.includes("column") && text.includes("sku");
}

function isMissingProductStockDeductionModeColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42703") {
    return text.includes("stock_deduction_mode");
  }
  return text.includes("column") && text.includes("stock_deduction_mode");
}

function isMissingProductCategoryColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42703") {
    return text.includes("category");
  }
  return text.includes("column") && text.includes("category");
}

function isMissingProductIsActiveColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42703") {
    return text.includes("is_active");
  }
  return text.includes("column") && text.includes("is_active");
}

function isMissingProductProjectionColumnError(error: PostgrestLikeError | null | undefined): boolean {
  return (
    isMissingProductSkuColumnError(error) ||
    isMissingProductStockDeductionModeColumnError(error) ||
    isMissingProductCategoryColumnError(error) ||
    isMissingProductIsActiveColumnError(error)
  );
}

function isMissingRecipesSchemaError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  return text.includes("recipes");
}

function resolveDefaultDeliveryConfig(channel: string) {
  return (
    DEFAULT_DELIVERY_CHANNEL_CONFIGS.find((entry) => entry.channel === channel) ?? {
      channel,
      commissionRatePct: 0,
      commissionVatRatePct: 7,
      orderCodeRule: "free_text" as const,
      orderCodeRegex: null as string | null,
      sourceUrl: null as string | null
    }
  );
}

function sanitizeUnitPrice(value: number | null | undefined, fallback: number): number {
  if (Number.isFinite(value) && Number(value) >= 0) {
    return roundMoney(Number(value));
  }
  return roundMoney(Math.max(0, fallback));
}

async function resolveOrderPricing(args: {
  auth: Awaited<ReturnType<typeof getPosApiAuthContext>>;
  body: PosCreateOrderPayload;
}): Promise<ResolvedOrderPricingResult> {
  const { auth, body } = args;
  const supabase = getSupabaseServiceClient();
  const taxSettings = await loadTaxSettings(auth);

  const normalizedItems = body.items.map((item) => ({
    product_id: String(item.product_id ?? "").trim(),
    quantity: Number(item.quantity),
    notes: item.notes ?? null
  }));
  if (normalizedItems.some((item) => !item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    return { ok: false, code: "invalid_quantity", status: 422, message: "Order item quantity must be greater than zero." };
  }

  const productIds = [...new Set(normalizedItems.map((item) => item.product_id))];
  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id,price,is_active")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .in("id", productIds);
  if (productError) {
    return { ok: false, code: "product_query_failed", status: 500, message: productError.message };
  }

  const productMap = new Map<string, { price: number; is_active: boolean }>();
  for (const row of productRows ?? []) {
    productMap.set(String(row.id), { price: Number(row.price), is_active: Boolean(row.is_active) });
  }
  for (const productId of productIds) {
    const product = productMap.get(productId);
    if (!product || !product.is_active) {
      return { ok: false, code: "product_not_found", status: 422, message: "One or more products are invalid." };
    }
  }

  const discountAmount = roundMoney(Math.max(0, Number(body.discount_amount ?? 0)));

  if (body.order_type !== "delivery_manual") {
    const pricedItems = normalizedItems.map((item) => {
      const basePrice = productMap.get(item.product_id)?.price ?? 0;
      return {
        ...item,
        unit_price: sanitizeUnitPrice(body.items.find((entry) => entry.product_id === item.product_id)?.unit_price, basePrice)
      };
    });
    const subtotal = roundMoney(pricedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0));
    const gpAmount = roundMoney(Math.max(0, Number(body.gp_amount ?? 0)));
    const baseTotalAmount = roundMoney(subtotal - discountAmount - gpAmount);
    const taxBreakdown = calculateTaxBreakdown(baseTotalAmount, taxSettings);
    const totalAmount = taxBreakdown.grand_total;
    if (totalAmount < 0) {
      return { ok: false, code: "invalid_total", status: 422, message: "Order total cannot be negative." };
    }

    return {
      ok: true,
      data: {
        items: pricedItems,
        subtotal,
        discountAmount,
        gpAmount,
        totalAmount,
        taxTotal: taxBreakdown.tax_total,
        grandTotal: taxBreakdown.grand_total,
        taxLines: taxBreakdown.lines,
        delivery_pricing_channel: null,
        delivery_app_subtotal: null,
        delivery_commission_rate_pct: null,
        delivery_commission_amount: null,
        delivery_commission_vat_rate_pct: null,
        delivery_commission_vat_amount: null,
        delivery_platform_fee_amount: null,
        delivery_net_payout_amount: null,
        delivery_pricing_source_url: null,
        delivery_pricing_note: null
      }
    };
  }

  const deliveryChannel = parseDeliveryChannel(body.channel);
  if (!deliveryChannel) {
    return { ok: false, code: "invalid_channel", status: 422, message: "Delivery channel is invalid." };
  }

  const externalOrderCode = body.external_order_code?.trim() ?? "";
  if (!externalOrderCode) {
    return { ok: false, code: "missing_external_order_code", status: 422, message: "external_order_code is required for delivery." };
  }

  const { data: configRow, error: configError } = await supabase
    .from("delivery_channel_configs")
    .select("channel,commission_rate_pct,commission_vat_rate_pct,order_code_rule,order_code_regex,source_url")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("channel", deliveryChannel)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<DeliveryConfigRow>();

  if (configError) {
    if (!isMissingDeliveryPricingSchemaError(configError)) {
      return { ok: false, code: "delivery_config_query_failed", status: 500, message: configError.message };
    }
  }

  const defaultConfig = resolveDefaultDeliveryConfig(deliveryChannel);
  const deliveryConfig = {
    channel: deliveryChannel,
    commissionRatePct: Number(configRow?.commission_rate_pct ?? defaultConfig.commissionRatePct ?? 0),
    commissionVatRatePct: Number(configRow?.commission_vat_rate_pct ?? defaultConfig.commissionVatRatePct ?? 7),
    orderCodeRule: configRow?.order_code_rule ?? defaultConfig.orderCodeRule,
    orderCodeRegex: configRow?.order_code_regex ?? defaultConfig.orderCodeRegex ?? null,
    sourceUrl: configRow?.source_url ?? defaultConfig.sourceUrl ?? null
  };

  const codeValidation = validateExternalOrderCode({
    channel: deliveryChannel,
    orderCode: externalOrderCode,
    rule: deliveryConfig.orderCodeRule,
    regex: deliveryConfig.orderCodeRegex
  });
  if (!codeValidation.ok) {
    return {
      ok: false,
      code: "invalid_external_order_code",
      status: 422,
      message: codeValidation.message ?? "External order code does not match delivery rule."
    };
  }

  const { data: channelPrices, error: channelPricesError } = await supabase
    .from("product_channel_prices")
    .select("product_id,app_price")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("channel", deliveryChannel)
    .eq("is_active", true)
    .in("product_id", productIds);
  if (channelPricesError) {
    if (!isMissingDeliveryPricingSchemaError(channelPricesError)) {
      return { ok: false, code: "delivery_prices_query_failed", status: 500, message: channelPricesError.message };
    }
  }

  const appPriceMap = new Map<string, number>();
  for (const row of channelPrices ?? []) {
    appPriceMap.set(String(row.product_id), Number(row.app_price));
  }

  const pricedItems = normalizedItems.map((item) => {
    const basePrice = productMap.get(item.product_id)?.price ?? 0;
    const appPrice = appPriceMap.get(item.product_id);
    return {
      ...item,
      unit_price: sanitizeUnitPrice(appPrice, basePrice)
    };
  });

  const subtotal = roundMoney(pricedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0));
  const pricingBreakdown = calculateDeliveryPricingBreakdown({
    appSubtotal: subtotal,
    commissionRatePct: deliveryConfig.commissionRatePct,
    commissionVatRatePct: deliveryConfig.commissionVatRatePct
  });
  const gpAmount = 0;
  const baseTotalAmount = roundMoney(subtotal - discountAmount);
  const taxBreakdown = calculateTaxBreakdown(baseTotalAmount, taxSettings);
  const totalAmount = taxBreakdown.grand_total;
  if (totalAmount < 0) {
    return { ok: false, code: "invalid_total", status: 422, message: "Order total cannot be negative." };
  }

  return {
    ok: true,
    data: {
      items: pricedItems,
      subtotal,
      discountAmount,
      gpAmount,
      totalAmount,
      taxTotal: taxBreakdown.tax_total,
      grandTotal: taxBreakdown.grand_total,
      taxLines: taxBreakdown.lines,
      delivery_pricing_channel: deliveryChannel,
      delivery_app_subtotal: pricingBreakdown.appSubtotal,
      delivery_commission_rate_pct: pricingBreakdown.commissionRatePct,
      delivery_commission_amount: pricingBreakdown.commissionAmount,
      delivery_commission_vat_rate_pct: pricingBreakdown.commissionVatRatePct,
      delivery_commission_vat_amount: pricingBreakdown.commissionVatAmount,
      delivery_platform_fee_amount: pricingBreakdown.platformFeeAmount,
      delivery_net_payout_amount: pricingBreakdown.netPayoutAmount,
      delivery_pricing_source_url: deliveryConfig.sourceUrl,
      delivery_pricing_note: "Per-order commission snapshot from active delivery channel config."
    }
  };
}

async function updateQueuedPosOrder(args: {
  auth: Awaited<ReturnType<typeof getPosApiAuthContext>>;
  body: PosCreateOrderPayload;
}) {
  const { auth, body } = args;
  const supabase = getSupabaseServiceClient();
  const targetOrderId = body.order_id?.trim();
  if (!targetOrderId) {
    return { ok: false as const, code: "invalid_order_id", status: 422, message: "order_id is required for update." };
  }

  if (body.order_type === "dine_in") {
    const tableId = body.table_id?.trim();
    if (!tableId) {
      return { ok: false as const, code: "table_id_required", status: 422, message: "table_id is required for dine-in update." };
    }
    const { data: rpcData, error: rpcError } = await supabase.rpc("replace_queued_dine_in_order_tx", {
      p_tenant_id: auth.tenantId!,
      p_branch_id: auth.branchId!,
      p_shift_id: body.shift_id,
      p_actor_user_id: auth.userId,
      p_order_id: targetOrderId,
      p_table_id: tableId,
      p_items: body.items,
      p_app_total_amount: body.app_total_amount,
      p_discount_amount: body.discount_amount ?? 0,
      p_gp_amount: body.gp_amount ?? 0,
      p_tax_total: body.tax_total ?? 0,
      p_grand_total: body.grand_total ?? null,
      p_tax_lines: body.tax_lines ?? []
    });
    if (rpcError) {
      const message = rpcError.message || "Unable to update queued dine-in order.";
      const code = message.includes("ORDER_NOT_QUEUED") ? "order_not_updatable"
        : message.includes("ORDER_NOT_FOUND") ? "order_not_found"
          : message.includes("TABLE_BILL_ORDER_CONFLICT") ? "table_bill_order_conflict"
            : message.includes("TABLE_BILL_NOT_OPEN") ? "table_bill_not_open"
              : "dine_in_order_update_failed";
      return { ok: false as const, code, status: code === "dine_in_order_update_failed" ? 500 : 409, message };
    }
    const updatedOrder = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as { order_id: string; order_no: string; order_status: string; created_at: string; total_amount: number } | null;
    if (!updatedOrder) {
      return { ok: false as const, code: "dine_in_order_update_failed", status: 500, message: "Unable to update queued dine-in order." };
    }
    return {
      ok: true as const,
      data: {
        id: updatedOrder.order_id,
        order_no: updatedOrder.order_no,
        status: updatedOrder.order_status,
        total_amount: updatedOrder.total_amount,
        created_at: updatedOrder.created_at,
        duplicate_request: false,
        updated_existing: true
      }
    };
  }

  const { data: existingOrder, error: existingOrderError } = await supabase
    .from("orders")
    .select("id,order_no,status,created_at")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("id", targetOrderId)
    .maybeSingle<{ id: string; order_no: string; status: string; created_at: string }>();

  if (existingOrderError) {
    return { ok: false as const, code: "order_query_failed", status: 500, message: existingOrderError.message };
  }
  if (!existingOrder) {
    return { ok: false as const, code: "order_not_found", status: 404, message: "Order not found in this branch." };
  }
  if (existingOrder.status !== "queued") {
    return { ok: false as const, code: "order_not_updatable", status: 409, message: "Only queued orders can be updated." };
  }

  const { data: shiftRow, error: shiftError } = await supabase
    .from("shifts")
    .select("id,status")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("id", body.shift_id)
    .eq("status", "open")
    .maybeSingle<{ id: string; status: string }>();
  if (shiftError) {
    return { ok: false as const, code: "shift_query_failed", status: 500, message: shiftError.message };
  }
  if (!shiftRow) {
    return { ok: false as const, code: "shift_not_open", status: 409, message: "Open shift is required before updating POS sale." };
  }

  const { data: previousItems, error: previousItemsError } = await supabase
    .from("order_items")
    .select("tenant_id,branch_id,order_id,product_id,quantity,unit_price,line_total,notes")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("order_id", targetOrderId);
  if (previousItemsError) {
    return { ok: false as const, code: "order_items_query_failed", status: 500, message: previousItemsError.message };
  }

  const { error: deleteItemsError } = await supabase
    .from("order_items")
    .delete()
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("order_id", targetOrderId);
  if (deleteItemsError) {
    return { ok: false as const, code: "order_items_delete_failed", status: 500, message: deleteItemsError.message };
  }

  const itemPayload = body.items.map((item) => {
    const unitPrice = roundMoney(Math.max(0, Number(item.unit_price ?? 0)));
    const quantity = Number(item.quantity);
    return {
      tenant_id: auth.tenantId!,
      branch_id: auth.branchId!,
      order_id: targetOrderId,
      product_id: item.product_id,
      quantity,
      unit_price: unitPrice,
      line_total: Number((unitPrice * quantity).toFixed(2)),
      notes: item.notes ?? null
    };
  });
  const { error: insertItemsError } = await supabase.from("order_items").insert(itemPayload);
  if (insertItemsError) {
    if ((previousItems ?? []).length > 0) {
      await supabase.from("order_items").insert(previousItems);
    }
    return { ok: false as const, code: "order_items_insert_failed", status: 500, message: insertItemsError.message };
  }

  const totalAmount = roundMoney(body.app_total_amount - Number(body.discount_amount ?? 0) - Number(body.gp_amount ?? 0));
  const taxTotal = roundMoney(Number(body.tax_total ?? 0));
  const grandTotal = roundMoney(Number(body.grand_total ?? totalAmount + taxTotal));
  const orderUpdatePayload = {
    shift_id: body.shift_id,
    order_type: body.order_type,
    channel: body.channel,
    table_id: null,
    external_order_code: body.external_order_code ?? null,
    customer_name: body.customer_name ?? null,
    notes: body.notes ?? null,
    subtotal: body.app_total_amount,
    discount_amount: body.discount_amount ?? 0,
    gp_amount: body.gp_amount ?? 0,
    total_amount: grandTotal,
    tax_total: taxTotal,
    grand_total: grandTotal,
    metadata: {
      tax_lines: body.tax_lines ?? []
    },
    delivery_pricing_channel: body.delivery_pricing_channel ?? null,
    delivery_app_subtotal: body.delivery_app_subtotal ?? null,
    delivery_commission_rate_pct: body.delivery_commission_rate_pct ?? null,
    delivery_commission_amount: body.delivery_commission_amount ?? null,
    delivery_commission_vat_rate_pct: body.delivery_commission_vat_rate_pct ?? null,
    delivery_commission_vat_amount: body.delivery_commission_vat_amount ?? null,
    delivery_platform_fee_amount: body.delivery_platform_fee_amount ?? null,
    delivery_net_payout_amount: body.delivery_net_payout_amount ?? null,
    delivery_pricing_source_url: body.delivery_pricing_source_url ?? null,
    delivery_pricing_note: body.delivery_pricing_note ?? null
  };
  const legacyOrderUpdatePayload = {
    shift_id: body.shift_id,
    order_type: body.order_type,
    channel: body.channel,
    table_id: null,
    external_order_code: body.external_order_code ?? null,
    customer_name: body.customer_name ?? null,
    notes: body.notes ?? null,
    subtotal: body.app_total_amount,
    discount_amount: body.discount_amount ?? 0,
    gp_amount: body.gp_amount ?? 0,
    total_amount: grandTotal,
    tax_total: taxTotal,
    grand_total: grandTotal,
    metadata: {
      tax_lines: body.tax_lines ?? []
    }
  };

  let orderUpdateQuery = supabase
    .from("orders")
    .update(orderUpdatePayload)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("id", targetOrderId)
    .eq("status", "queued")
    .select("id,order_no,status,created_at,total_amount")
    .maybeSingle<{ id: string; order_no: string; status: string; created_at: string; total_amount: number }>();
  let { data: updatedOrder, error: updateOrderError } = await orderUpdateQuery;
  if (updateOrderError && isMissingOrderDeliverySnapshotColumnError(updateOrderError)) {
    const legacyUpdateQuery = supabase
      .from("orders")
      .update(legacyOrderUpdatePayload)
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", targetOrderId)
      .eq("status", "queued")
      .select("id,order_no,status,created_at,total_amount")
      .maybeSingle<{ id: string; order_no: string; status: string; created_at: string; total_amount: number }>();
    ({ data: updatedOrder, error: updateOrderError } = await legacyUpdateQuery);
  }

  if (updateOrderError) {
    await supabase
      .from("order_items")
      .delete()
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("order_id", targetOrderId);
    if ((previousItems ?? []).length > 0) {
      await supabase.from("order_items").insert(previousItems);
    }
    return { ok: false as const, code: "order_update_failed", status: 500, message: updateOrderError.message };
  }
  if (!updatedOrder) {
    return { ok: false as const, code: "order_not_updatable", status: 409, message: "Only queued orders can be updated." };
  }

  return {
    ok: true as const,
    data: {
      id: updatedOrder.id,
      order_no: updatedOrder.order_no,
      status: updatedOrder.status,
      total_amount: updatedOrder.total_amount,
      created_at: updatedOrder.created_at,
      duplicate_request: false,
      updated_existing: true
    }
  };
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const { auth, devicePolicy, scope } = await requireSalesSessionContext("sales:enter");
    const { searchParams } = new URL(request.url);
    if (searchParams.get("resource") === "tax-settings") {
      const taxSettings = await loadTaxSettings(auth);
      const response = ok({
        tenant_id: auth.tenantId,
        branch_id: auth.branchId,
        tax_settings: taxSettings
      });
      response.headers.set("x-pos-sales-ms", String(Date.now() - startedAt));
      return response;
    }

    const supabase = getSupabaseServiceClient();

    const [
      { data: shiftData, error: shiftError },
      { data: productData, error: productError },
      storeProfile,
      { data: deliveryConfigs, error: deliveryConfigsError },
      { data: deliveryPrices, error: deliveryPricesError },
      { data: recipeProductRows, error: recipeProductRowsError },
      { data: recipeStockRows, error: recipeStockRowsError },
      { data: inventorySettings, error: inventorySettingsError },
      { data: paymentAccounts, error: paymentAccountsError },
      { data: paymentProviderSettings, error: paymentProviderSettingsError },
      taxSettings,
      notificationSettings
    ] = await Promise.all([
      supabase
        .from("shifts")
        .select("id,opened_at,status,opening_cash")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (async () => {
        const queryProducts = (args: { selectClause: string; filterActive: boolean; orderByCategory: boolean }) => {
          let query = supabase
            .from("products")
            .select(args.selectClause)
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!);
          if (args.filterActive) {
            query = query.eq("is_active", true);
          }
          if (args.orderByCategory) {
            query = query.order("category", { ascending: true });
          }
          return query.order("name", { ascending: true });
        };

        const selectCandidates = [
          { selectClause: "id,sku,name,category,price,is_active,stock_deduction_mode", filterActive: true, orderByCategory: true },
          { selectClause: "id,sku,name,category,price,is_active", filterActive: true, orderByCategory: true },
          { selectClause: "id,name,category,price,is_active", filterActive: true, orderByCategory: true },
          { selectClause: "id,sku,name,price,is_active,stock_deduction_mode", filterActive: true, orderByCategory: false },
          { selectClause: "id,sku,name,price,is_active", filterActive: true, orderByCategory: false },
          { selectClause: "id,name,price,is_active", filterActive: true, orderByCategory: false },
          { selectClause: "id,sku,name,category,price,stock_deduction_mode", filterActive: false, orderByCategory: true },
          { selectClause: "id,sku,name,category,price", filterActive: false, orderByCategory: true },
          { selectClause: "id,name,category,price", filterActive: false, orderByCategory: true },
          { selectClause: "id,sku,name,price,stock_deduction_mode", filterActive: false, orderByCategory: false },
          { selectClause: "id,sku,name,price", filterActive: false, orderByCategory: false },
          { selectClause: "id,name,price", filterActive: false, orderByCategory: false }
        ] as const;

        let lastResult = await queryProducts(selectCandidates[0]);
        if (!lastResult.error) return lastResult;

        for (const candidate of selectCandidates.slice(1)) {
          if (!isMissingProductProjectionColumnError(lastResult.error)) {
            return lastResult;
          }
          const fallbackResult = await queryProducts(candidate);
          lastResult = fallbackResult;
          if (!fallbackResult.error) {
            return fallbackResult;
          }
        }

        return lastResult;
      })(),
      loadReceiptStoreProfile(auth.tenantId!),
      supabase
        .from("delivery_channel_configs")
        .select("channel,commission_rate_pct,commission_vat_rate_pct,order_code_rule,order_code_regex,source_url")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("is_active", true),
      supabase
        .from("product_channel_prices")
        .select("product_id,channel,app_price")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("is_active", true),
      supabase
        .from("recipes")
        .select("product_id,ingredients(name)")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!),
      supabase
        .from("recipes")
        .select("product_id,quantity_per_item,ingredients(quantity_on_hand)")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!),
      supabase
        .from("branch_inventory_settings")
        .select("allow_negative_stock")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .maybeSingle<{ allow_negative_stock: boolean }>(),
      supabase
        .from("tenant_payment_accounts")
        .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,qr_mode,applies_to_all_branches,is_active")
        .eq("tenant_id", auth.tenantId!)
        .eq("is_active", true)
        .or(`branch_id.eq.${auth.branchId!},applies_to_all_branches.eq.true`)
        .order("applies_to_all_branches", { ascending: true })
        .order("updated_at", { ascending: false }),
      supabase
        .from("pos_payment_provider_settings")
        .select("provider,environment,merchant_id,is_active")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("is_active", true),
      loadTaxSettings(auth),
      loadPosNotificationSettings(auth)
    ]);

    if (productError) {
      return fail("product_query_failed", productError.message, 500);
    }
    const missingDeliverySchema =
      isMissingDeliveryPricingSchemaError(deliveryConfigsError) ||
      isMissingDeliveryPricingSchemaError(deliveryPricesError) ||
      Boolean(deliveryConfigsError) ||
      Boolean(deliveryPricesError);

    const recipeProductIdSet = new Set(
      ((recipeProductRowsError ? [] : recipeProductRows) as RecipeProductRow[])
        .filter((row) => {
          const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
          const ingredientName = String(ingredient?.name ?? "").trim();
          return Boolean(ingredientName) && !ingredientName.startsWith("STOCK:");
        })
        .map((row) => String(row.product_id ?? "").trim())
        .filter(Boolean)
    );
    const allowNegativeStock = inventorySettingsError ? false : Boolean(inventorySettings?.allow_negative_stock ?? false);
    const sellableStockByProduct = new Map<string, number | null>();
    if (!recipeStockRowsError) {
      const capsByProduct = new Map<string, number[]>();
      for (const row of (recipeStockRows ?? []) as RecipeStockRow[]) {
        const requiredQty = Number(row.quantity_per_item ?? 0);
        if (!Number.isFinite(requiredQty) || requiredQty <= 0) continue;
        const ingredientRecord = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
        const onHand = Number(ingredientRecord?.quantity_on_hand ?? 0);
        const productId = String(row.product_id);
        const caps = capsByProduct.get(productId) ?? [];
        caps.push(Math.floor(onHand / requiredQty));
        capsByProduct.set(productId, caps);
      }
      for (const [productId, caps] of capsByProduct.entries()) {
        sellableStockByProduct.set(productId, caps.length > 0 ? Math.min(...caps) : null);
      }
    }

    const normalizedProducts = ((productData ?? []) as unknown as PosProductQueryRow[]).map((row) => {
      const sku = String(row.sku ?? "").trim();
      return {
        id: String(row.id),
        sku,
        name: String(row.name ?? ""),
        category: String(row.category ?? ""),
        price: Number(row.price ?? 0),
        is_active: Boolean(row.is_active),
        stock_deduction_mode: row.stock_deduction_mode === "recipe_deduction" ? "recipe_deduction" : "unit_only",
        has_recipe_deduction: row.stock_deduction_mode === "recipe_deduction" && recipeProductIdSet.has(String(row.id)),
        stock_on_hand_units: sellableStockByProduct.has(String(row.id)) ? sellableStockByProduct.get(String(row.id)) : null,
        is_out_of_stock:
          !allowNegativeStock &&
          sellableStockByProduct.has(String(row.id)) &&
          Number(sellableStockByProduct.get(String(row.id)) ?? 0) <= 0
      };
    });

    const categories = Array.from(new Set(normalizedProducts.map((row) => row.category))).filter(Boolean);
    const fallbackConfigs = DEFAULT_DELIVERY_CHANNEL_CONFIGS.map((entry) => ({
      channel: entry.channel,
      commission_rate_pct: entry.commissionRatePct,
      commission_vat_rate_pct: entry.commissionVatRatePct,
      order_code_rule: entry.orderCodeRule,
      order_code_regex: entry.orderCodeRegex,
      source_url: entry.sourceUrl
    }));
    const activeDeliveryConfigs =
      !missingDeliverySchema && (deliveryConfigs ?? []).length > 0 ? (deliveryConfigs ?? []) : fallbackConfigs;
    const activePaymentAccountRows = ((paymentAccounts ?? []) as PaymentAccountRow[]);
    const branchPaymentAccount = activePaymentAccountRows.find(
      (account) => account.branch_id === auth.branchId && account.applies_to_all_branches !== true
    );
    const tenantWidePaymentAccount = activePaymentAccountRows.find((account) => account.applies_to_all_branches === true);
    const activePaymentAccount = isMissingPaymentAccountSchemaError(paymentAccountsError)
      ? null
      : mapPaymentAccount(branchPaymentAccount ?? tenantWidePaymentAccount);
    const inetNopsFeatureEnabled = await hasBranchFeatureSafe(auth.tenantId!, auth.branchId!, "inet_nops_qr");
    const inetNopsProvider = !inetNopsFeatureEnabled || isMissingPaymentProviderSchemaError(paymentProviderSettingsError)
      ? null
      : ((paymentProviderSettings ?? []) as PaymentProviderSettingRow[]).find((row) => row.provider === "inet_nops" && row.is_active !== false) ?? null;
    const deliveryPricesByProduct = (missingDeliverySchema ? [] : deliveryPrices ?? []).reduce<Record<string, Record<string, number>>>((acc, row) => {
      const productId = String(row.product_id);
      const channel = String(row.channel);
      if (!acc[productId]) {
        acc[productId] = {};
      }
      acc[productId][channel] = Number(row.app_price);
      return acc;
    }, {});

    const response = ok({
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      shift: shiftError ? null : shiftData ?? null,
      categories,
      products: normalizedProducts,
      inventory_settings: {
        allow_negative_stock: allowNegativeStock
      },
      operator_name: scope.user.full_name ?? auth.userId,
      branch_name: scope.branch?.name ?? auth.branchId,
      store_profile: storeProfile,
      payment_account: activePaymentAccount,
      payment_providers: {
        inet_nops: inetNopsProvider
          ? {
              is_active: true,
              environment: inetNopsProvider.environment === "production" ? "production" : "uat"
            }
          : null
      },
      tax_settings: taxSettings,
      notification_settings: notificationSettings,
      device_policy: devicePolicy,
      delivery_configs: activeDeliveryConfigs,
      delivery_prices_by_product: deliveryPricesByProduct
    });
    if (missingDeliverySchema) {
      response.headers.set("x-pos-sales-delivery-fallback", "1");
    }
    response.headers.set("x-pos-sales-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = failFromSalesError(error, "unauthorized", 401);
    response.headers.set("x-pos-sales-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const { auth, devicePolicy, scope } = await requireSalesSessionContext("sales:enter");
    if (devicePolicy.block_sales) {
      const response = fail(devicePolicy.reason_code ?? "pos_device_unavailable", getDevicePolicyBlockMessage(devicePolicy), 423);
      response.headers.set("x-pos-sales-device-status", devicePolicy.status);
      response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
      return response;
    }
    const supabase = getSupabaseServiceClient();
    const body = (await req.json()) as PosCreateOrderPayload;
    let usedShiftFallback = false;

    if (!body.shift_id) {
      return fail("missing_shift_id", "shift_id is required.", 422);
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return fail("invalid_items", "Order items are required.", 422);
    }
    if (!["dine_in", "takeaway", "delivery_manual"].includes(body.order_type)) {
      return fail("invalid_order_type", "Unsupported order_type.", 422);
    }
    if (body.order_type === "dine_in" && !body.table_id) {
      return fail("table_required", "table_id is required for dine-in order.", 422);
    }
    if (body.order_type === "dine_in" && body.table_id) {
      const { data: tableRow, error: tableError } = await supabase
        .from("dining_tables")
        .select("id,is_active,status")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", body.table_id)
        .maybeSingle<{ id: string; is_active: boolean; status: string }>();

      if (tableError) {
        return fail("table_query_failed", tableError.message, 500);
      }
      if (!tableRow || !tableRow.is_active || tableRow.status === "disabled" || tableRow.status === "reserved") {
        return fail("table_not_available", "Selected table is not available for dine-in bill.", 409);
      }
    }

    let effectiveShiftId = String(body.shift_id ?? "").trim();
    const { data: requestedShift, error: requestedShiftError } = await supabase
      .from("shifts")
      .select("id")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", effectiveShiftId)
      .eq("status", "open")
      .maybeSingle<{ id: string }>();

    if (requestedShiftError) {
      return fail("shift_query_failed", requestedShiftError.message, 500);
    }

    if (!requestedShift) {
      const { data: latestOpenShift, error: latestOpenShiftError } = await supabase
        .from("shifts")
        .select("id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (latestOpenShiftError) {
        return fail("shift_query_failed", latestOpenShiftError.message, 500);
      }
      if (!latestOpenShift?.id) {
        return fail("shift_not_open", "Open shift is required before creating POS sale.", 409);
      }
      effectiveShiftId = latestOpenShift.id;
      usedShiftFallback = true;
    }

    const pricing = await resolveOrderPricing({ auth, body });
    if (!pricing.ok) {
      return fail(pricing.code, pricing.message, pricing.status);
    }

    const normalizedBody: PosCreateOrderPayload = {
      ...body,
      shift_id: effectiveShiftId,
      app_total_amount: pricing.data.subtotal,
      discount_amount: pricing.data.discountAmount,
      gp_amount: pricing.data.gpAmount,
      tax_total: pricing.data.taxTotal,
      grand_total: pricing.data.grandTotal,
      tax_lines: pricing.data.taxLines,
      delivery_pricing_channel: pricing.data.delivery_pricing_channel,
      delivery_app_subtotal: pricing.data.delivery_app_subtotal,
      delivery_commission_rate_pct: pricing.data.delivery_commission_rate_pct,
      delivery_commission_amount: pricing.data.delivery_commission_amount,
      delivery_commission_vat_rate_pct: pricing.data.delivery_commission_vat_rate_pct,
      delivery_commission_vat_amount: pricing.data.delivery_commission_vat_amount,
      delivery_platform_fee_amount: pricing.data.delivery_platform_fee_amount,
      delivery_net_payout_amount: pricing.data.delivery_net_payout_amount,
      delivery_pricing_source_url: pricing.data.delivery_pricing_source_url,
      delivery_pricing_note: pricing.data.delivery_pricing_note,
      items: pricing.data.items
    };

    if (normalizedBody.order_id) {
      const updated = await updateQueuedPosOrder({ auth, body: normalizedBody });
      if (!updated.ok) {
        if (normalizedBody.order_type !== "dine_in" && (updated.code === "order_not_updatable" || updated.code === "order_not_found")) {
          normalizedBody.order_id = undefined;
        } else {
          const response = fail(updated.code, updated.message, updated.status);
          response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
          return response;
        }
      } else {
        await queueKitchenPrintRecoveryForPosOrder({ auth, orderId: updated.data.id, runtimeDeviceCode: scope.session.device_code });
        invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
        invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId!, branchId: auth.branchId! });
        const response = ok(updated.data, 200);
        response.headers.set("x-pos-sales-shift-fallback", usedShiftFallback ? "1" : "0");
        response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
        return response;
      }
    }

    const { count: queuedCount, error: queuedCountError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("status", "queued");
    if (queuedCountError) {
      const response = fail("order_queue_depth_query_failed", queuedCountError.message, 500);
      response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
      return response;
    }
    if ((queuedCount ?? 0) >= POS_GUARDS.orderQueueHardLimit) {
      const response = fail(
        "order_queue_overloaded",
        `Queued orders reached limit (${queuedCount}/${POS_GUARDS.orderQueueHardLimit}). Please complete or cancel some bills first.`,
        429
      );
      response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
      return response;
    }

    const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || undefined;
    const result = await executeCreatePosOrderTransaction({
      auth,
      input: normalizedBody,
      idempotencyKey
    });

    if (!result.ok) {
      const response = fail(result.code, result.message, result.status);
      response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
      return response;
    }

    const createdOrderId = String((result.data as { id?: unknown; order_id?: unknown }).id ?? (result.data as { id?: unknown; order_id?: unknown }).order_id ?? "");
    if (!result.data.duplicate_request) await queueKitchenPrintRecoveryForPosOrder({ auth, orderId: createdOrderId, runtimeDeviceCode: scope.session.device_code });
    invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    invalidatePosSalesListCacheForScope({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    const response = ok(result.data, result.data.duplicate_request ? 200 : 201);
    const stockBypassed = Boolean((result.data as { stock_bypassed?: boolean }).stock_bypassed);
    response.headers.set("x-pos-sales-create-path", stockBypassed ? "direct_fallback_bypass" : "direct_or_rpc");
    response.headers.set("x-pos-sales-stock-bypassed", stockBypassed ? "1" : "0");
    response.headers.set("x-pos-sales-shift-fallback", usedShiftFallback ? "1" : "0");
    response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = failFromSalesError(error, "pos_sales_create_failed", 400);
    response.headers.set("x-pos-sales-post-ms", String(Date.now() - startedAt));
    return response;
  }
}
