export function asProductMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function isProductRecommended(metadata: unknown): boolean {
  const record = asProductMetadata(metadata);
  return record.is_recommended === true || record.recommended === true;
}

export function withProductRecommendedMetadata(metadata: unknown, isRecommended: boolean): Record<string, unknown> {
  return {
    ...asProductMetadata(metadata),
    is_recommended: isRecommended
  };
}
