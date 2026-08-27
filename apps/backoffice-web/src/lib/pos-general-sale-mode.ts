export const GENERAL_SALE_MODE_ID = "general_sale" as const;
export const GENERAL_SALE_BUSINESS_GROUP = "SD" as const;
export const GENERAL_SALE_CHECKOUT_BASE_MODE = "home" as const;
export const GENERAL_SALE_ROOT_ATTRIBUTE = "data-pos-business-mode";
export const GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE = "data-pos-product-sku";

export function normalizeGeneralSaleScanCode(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleUpperCase("en-US");
}

export function isExactGeneralSaleSkuMatch(scanCode: unknown, productSku: unknown): boolean {
  const scan = normalizeGeneralSaleScanCode(scanCode);
  if (!scan) return false;
  return scan === normalizeGeneralSaleScanCode(productSku);
}
