export const GENERAL_SALE_MODE_ID = "general_sale" as const;
export const GENERAL_SALE_BUSINESS_GROUP = "SD" as const;
export const GENERAL_SALE_CHECKOUT_BASE_MODE = "home" as const;
export const GENERAL_SALE_ROOT_ATTRIBUTE = "data-pos-business-mode";
export const GENERAL_SALE_LAYOUT_ATTRIBUTE = "data-pos-general-sale-layout";
export const GENERAL_SALE_LAYOUT_STORAGE_KEY = "cpipos_general_sale_layout_v1";
export const GENERAL_SALE_PRODUCT_SKU_ATTRIBUTE = "data-pos-product-sku";
export const GENERAL_SALE_ADD_PRODUCT_EVENT = "cpipos:general-sale-add-product";
export const GENERAL_SALE_ADD_PRODUCT_RESULT_EVENT = "cpipos:general-sale-add-product-result";

export type GeneralSaleCartLayout = "grid" | "table";

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

const THAI_NUMERAL_TO_ASCII: Record<string, string> = {
  "๐": "0",
  "๑": "1",
  "๒": "2",
  "๓": "3",
  "๔": "4",
  "๕": "5",
  "๖": "6",
  "๗": "7",
  "๘": "8",
  "๙": "9"
};

// Thai Kedmanee layout values produced by the physical 1..0 number-row keys.
// Keyboard-wedge barcode scanners emit physical key presses, so Windows can turn
// a numeric barcode into these characters when the active layout is Thai.
const THAI_KEDMANEE_NUMBER_ROW_TO_ASCII: Record<string, string> = {
  "ๅ": "1",
  "/": "2",
  "-": "3",
  "ภ": "4",
  "ถ": "5",
  "ุ": "6",
  "ึ": "7",
  "ค": "8",
  "ต": "9",
  "จ": "0"
};

function normalizeThaiNumerals(value: string): string {
  return value.replace(/[๐-๙]/gu, (character) => THAI_NUMERAL_TO_ASCII[character] ?? character);
}

function normalizeThaiKedmaneeBarcodeDigits(value: string): string {
  const candidate = value.trim();
  if (!candidate || !/^[ๅ/\-ภถุึคตจ]+$/u.test(candidate)) return value;

  // Require an unambiguous Thai-layout character, or a barcode-like length.
  // This keeps ordinary short SKU punctuation such as "-" or "/" untouched.
  const looksLikeThaiScannerOutput = /[ๅภถุึคตจ]/u.test(candidate) || candidate.length >= 6;
  if (!looksLikeThaiScannerOutput) return value;

  return Array.from(candidate, (character) => THAI_KEDMANEE_NUMBER_ROW_TO_ASCII[character] ?? character).join("");
}

export function normalizeGeneralSaleCartLayout(value: unknown): GeneralSaleCartLayout {
  return value === "table" ? "table" : "grid";
}

export function normalizeGeneralSaleScanCode(value: unknown): string {
  const normalized = normalizeThaiKedmaneeBarcodeDigits(
    normalizeThaiNumerals(
      String(value ?? "")
        .normalize("NFKC")
        .trim()
        .toLocaleUpperCase("en-US")
    )
  );
  if (!normalized) return "";

  // Product Management normalizes persisted SKUs to digits when the source contains digits.
  // Applying the same rule here keeps legacy values such as PRD-...-097339 compatible
  // with a scanner that sends the canonical code 097339 without relying on suffix matching.
  // Thai numeral and Thai Kedmanee number-row output are decoded first so scanners keep
  // working even while Windows is using the Thai keyboard layout.
  const digits = normalized.replace(/\D+/g, "");
  return digits || normalized;
}

export function isExactGeneralSaleSkuMatch(scanCode: unknown, productSku: unknown): boolean {
  const scan = normalizeGeneralSaleScanCode(scanCode);
  if (!scan) return false;
  return scan === normalizeGeneralSaleScanCode(productSku);
}
