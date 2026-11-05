export function asProductMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function isProductRecommended(metadata: unknown): boolean {
  const record = asProductMetadata(metadata);
  return record.is_recommended === true || record.recommended === true;
}

export function getProductSpecialPrice(metadata: unknown): number | null {
  const record = asProductMetadata(metadata);
  const raw = record.special_price;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Number(value.toFixed(2));
}

export function withProductRecommendedMetadata(metadata: unknown, isRecommended: boolean): Record<string, unknown> {
  return {
    ...asProductMetadata(metadata),
    is_recommended: isRecommended
  };
}

export function withProductSpecialPriceMetadata(metadata: unknown, specialPrice: number | null): Record<string, unknown> {
  const next = { ...asProductMetadata(metadata) };
  if (specialPrice === null) {
    delete next.special_price;
    return next;
  }
  next.special_price = Number(specialPrice.toFixed(2));
  return next;
}

export function withProductManagementMetadata(
  metadata: unknown,
  input: { isRecommended: boolean; specialPrice: number | null }
): Record<string, unknown> {
  return withProductSpecialPriceMetadata(
    withProductRecommendedMetadata(metadata, input.isRecommended),
    input.specialPrice
  );
}
