export const GENERAL_SALE_MODE_ID = "general_sale" as const;
export const GENERAL_SALE_BUSINESS_GROUP = "SD" as const;
export const GENERAL_SALE_CHECKOUT_BASE_MODE = "home" as const;
export const GENERAL_SALE_ROOT_ATTRIBUTE = "data-pos-business-mode";
export const GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE = "data-pos-product-sku";
export const GENERAL_SALE_ADD_PRODUCT_EVENT = "cpipos:general-sale-add-product";
export const GENERAL_SALE_ADD_PRODUCT_RESULT_EVENT = "cpipos:general-sale-add-product-result";

export type GeneralSaleLookupProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  stock_deduction_mode?: "unit_only" | "recipe_deduction";
  stock_on_hand_units?: number | null;
  is_out_of_stock?: boolean;
  has_recipe_deduction?: boolean;
  is_recommended?: boolean;
};

export type GeneralSaleAddProductRequest = {
  requestId: string;
  product: GeneralSaleLookupProduct;
};

export type GeneralSaleAddProductResult = {
  requestId: string;
  status: "added" | "unavailable" | "invalid";
};

export function normalizeGeneralSaleScanCode(value: unknown): string {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleUpperCase("en-US");
  if (!normalized) return "";

  // Product Management normalizes persisted SKUs to digits when the source contains digits.
  // Applying the same rule here keeps legacy values such as PRD-...-097339 compatible
  // with a scanner that sends the canonical code 097339 without relying on suffix matching.
  const digits = normalized.replace(/\D+/g, "");
  return digits || normalized;
}

export function isExactGeneralSaleSkuMatch(scanCode: unknown, productSku: unknown): boolean {
  const scan = normalizeGeneralSaleScanCode(scanCode);
  if (!scan) return false;
  return scan === normalizeGeneralSaleScanCode(productSku);
}
