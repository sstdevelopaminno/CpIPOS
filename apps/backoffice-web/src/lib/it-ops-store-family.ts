export const RESTAURANT_QR_STORE_PREFIX = "FG" as const;
export const BUFFET_STORE_PREFIX = "FF" as const;
export const RESERVED_BUFFET_STORE_CODE = "FF0001" as const;

export type StoreCodeFamily = "RESTAURANT_QR" | "BUFFET" | "OTHER";

export function normalizeStoreCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Naming-family classification only. This must never be used as a feature
 * activation or authorization gate. Product activation stays explicit.
 */
export function classifyStoreCodeFamily(value: string | null | undefined): StoreCodeFamily {
  const code = normalizeStoreCode(value);
  if (code.startsWith(RESTAURANT_QR_STORE_PREFIX)) return "RESTAURANT_QR";
  if (code.startsWith(BUFFET_STORE_PREFIX)) return "BUFFET";
  return "OTHER";
}

export function storeCodeFamilyLabel(value: string | null | undefined): string {
  const family = classifyStoreCodeFamily(value);
  if (family === "RESTAURANT_QR") return "Restaurant QR";
  if (family === "BUFFET") return "Buffet";
  return "Core / Other";
}
