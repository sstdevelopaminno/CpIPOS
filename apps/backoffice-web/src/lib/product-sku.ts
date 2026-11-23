/**
 * SKU is the single printable product identifier (also scanned as Code128).
 * Preserve leading zeros, alphabetic codes and delimiters; never strip
 * letters or silently convert a manually entered SKU to another product.
 */
export type ProductSkuMode = "auto" | "manual" | "both";

export function normalizeProductSku(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

export function isValidProductSku(value: string): boolean {
  return value.length >= 1 && value.length <= 40 && /^[A-Z0-9][A-Z0-9._-]*$/.test(value);
}

export function selectedProductSku(input: { mode: ProductSkuMode; sku?: string | null }, generate: () => string): string | null {
  if (input.mode === "auto") return generate();
  const value = normalizeProductSku(input.sku);
  if (!value) return input.mode === "both" ? generate() : null;
  return isValidProductSku(value) ? value : null;
}
