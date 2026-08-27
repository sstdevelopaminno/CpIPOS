export const GROCERY_MODE_ID = "grocery";
export const GROCERY_CHECKOUT_BASE_MODE = "home" as const;
export const GROCERY_ROOT_ATTRIBUTE = "data-pos-business-mode";
export const GROCERY_PRODUCT_SKU_ATTRIBUTE = "data-pos-product-sku";

export function normalizeGroceryScanCode(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleUpperCase("en-US");
}

export function isExactGrocerySkuMatch(scanCode: unknown, productSku: unknown): boolean {
  const scan = normalizeGroceryScanCode(scanCode);
  if (!scan) return false;
  return scan === normalizeGroceryScanCode(productSku);
}
