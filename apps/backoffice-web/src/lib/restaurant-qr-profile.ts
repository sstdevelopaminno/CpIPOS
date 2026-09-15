export const RESTAURANT_QR_PRODUCT_PROFILE = "RESTAURANT_QR" as const;
export const RESTAURANT_QR_INTERNAL_REVIEW_SOURCE = "restaurant_qr_pos_review_internal";
export const RESTAURANT_QR_LEGACY_INTERNAL_REVIEW_SOURCES = ["fg0003_pos_review_internal"] as const;

export type QrKitchenHardeningFlags = {
  qr_pos_review_required: boolean;
  global_qr_order_alert: boolean;
  kitchen_send_confirmation: boolean;
};

export type RestaurantQrScope = {
  tenantId?: string | null;
  branchId?: string | null;
  tenantCode?: string | null;
  branchCode?: string | null;
  productProfile?: string | null;
};

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isRestaurantQrInternalReviewSource(value: unknown): boolean {
  const source = String(value ?? "").trim();
  return source === RESTAURANT_QR_INTERNAL_REVIEW_SOURCE || RESTAURANT_QR_LEGACY_INTERNAL_REVIEW_SOURCES.includes(source as never);
}

export function isRestaurantQrProfileEnabled(scope: RestaurantQrScope): boolean {
  const explicitProfile = normalizeCode(scope.productProfile) === RESTAURANT_QR_PRODUCT_PROFILE;
  if (explicitProfile) return true;
  const tenantCode = normalizeCode(scope.tenantCode);
  const branchCode = normalizeCode(scope.branchCode);
  return tenantCode.startsWith("FG") || branchCode.startsWith("FG");
}

export function resolveRestaurantQrKitchenFlags(scope: RestaurantQrScope): QrKitchenHardeningFlags {
  const enabled = isRestaurantQrProfileEnabled(scope);
  return {
    qr_pos_review_required: enabled,
    global_qr_order_alert: enabled,
    kitchen_send_confirmation: enabled
  };
}

export function isRestaurantQrKitchenHardeningEnabled(flags: QrKitchenHardeningFlags): boolean {
  return flags.qr_pos_review_required && flags.global_qr_order_alert && flags.kitchen_send_confirmation;
}

export function isRestaurantQrScope(scope: RestaurantQrScope): boolean {
  return isRestaurantQrProfileEnabled(scope);
}
