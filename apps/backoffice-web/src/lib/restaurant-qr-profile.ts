export const RESTAURANT_QR_PRODUCT_PROFILE = "RESTAURANT_QR" as const;
export const RESTAURANT_QR_INTERNAL_REVIEW_SOURCE = "restaurant_qr_pos_review_internal";
export const RESTAURANT_QR_LEGACY_INTERNAL_REVIEW_SOURCES = ["fg0003_pos_review_internal"] as const;
export const RESTAURANT_QR_RESERVED_NEXT_STORE_CODE = "FG0004";

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

const RESTAURANT_QR_ENABLED_SCOPES = [
  {
    tenantId: "2d38bd23-bf2d-4b9a-a7cf-adb2547297ed",
    branchId: "41eee367-6762-4277-bfc8-c2e9776a8ef9",
    tenantCode: "FG0003",
    branchCode: "FG0003-BKK-01",
    productProfile: RESTAURANT_QR_PRODUCT_PROFILE,
    status: "enabled"
  }
] as const;

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isRestaurantQrInternalReviewSource(value: unknown): boolean {
  const source = String(value ?? "").trim();
  return source === RESTAURANT_QR_INTERNAL_REVIEW_SOURCE || RESTAURANT_QR_LEGACY_INTERNAL_REVIEW_SOURCES.includes(source as never);
}

export function isRestaurantQrProfileEnabled(scope: RestaurantQrScope): boolean {
  const explicitProfile = normalizeCode(scope.productProfile) === RESTAURANT_QR_PRODUCT_PROFILE;
  if (explicitProfile) return true;
  const tenantId = normalizeId(scope.tenantId);
  const branchId = normalizeId(scope.branchId);
  const tenantCode = normalizeCode(scope.tenantCode);
  const branchCode = normalizeCode(scope.branchCode);
  return RESTAURANT_QR_ENABLED_SCOPES.some((entry) => (
    (tenantId && tenantId === entry.tenantId)
    || (branchId && branchId === entry.branchId)
    || (tenantCode && tenantCode === entry.tenantCode)
    || (branchCode && branchCode === entry.branchCode)
  ));
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
