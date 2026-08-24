export const BUFFET_PRODUCT_PROFILE = "BUFFET" as const;
export const BUFFET_STORE_CODE_PREFIX = "FF" as const;
export const BUFFET_RESERVED_FIRST_STORE_CODE = "FF0001" as const;

export type BuffetScope = {
  tenantCode?: string | null;
  branchCode?: string | null;
  productProfile?: string | null;
};

export type BuffetFeatureFlags = {
  guest_count: boolean;
  session_timer: boolean;
  package_pricing: boolean;
  ordering_rounds: boolean;
  last_order_cutoff: boolean;
  extra_charge_rules: boolean;
};

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isBuffetStoreCode(value: string | null | undefined): boolean {
  return normalize(value).startsWith(BUFFET_STORE_CODE_PREFIX);
}

export function isBuffetProfileEnabled(scope: BuffetScope): boolean {
  if (normalize(scope.productProfile) === BUFFET_PRODUCT_PROFILE) return true;
  return isBuffetStoreCode(scope.tenantCode) || isBuffetStoreCode(scope.branchCode);
}

export function resolveBuffetFeatureFlags(scope: BuffetScope): BuffetFeatureFlags {
  const enabled = isBuffetProfileEnabled(scope);
  return {
    guest_count: enabled,
    session_timer: enabled,
    package_pricing: enabled,
    ordering_rounds: enabled,
    last_order_cutoff: enabled,
    extra_charge_rules: enabled
  };
}
